import { createConnectors } from "../connectors";
import * as cursorRepo from "../db/repositories/cursor.repository";
import * as messageRepo from "../db/repositories/message.repository";
import { processBatch, reprocessUnprocessed } from "./processor.service";
import { config } from "../config";
import type { DataSource } from "../types/events";
import { logger } from "../utils/logger";

const DEFAULT_TENANT = "default";

export interface PollCycleResult {
  sourcesPolled: number;
  eventsIngested: number;
  eventsProcessed: number;
  aiReprocessed: number;
  bySource: Record<
    DataSource,
    { ingested: number; processed: number; reprocessed: number; stored: number }
  >;
}

let pollCycleInFlight: Promise<PollCycleResult> | null = null;

export interface PollCycleOptions {
  /** When false, only ingest new messages — skip AI backlog (default for startup). */
  reprocessBacklog?: boolean;
}

export async function runPollCycle(
  tenantId = DEFAULT_TENANT,
  options: PollCycleOptions = {}
): Promise<PollCycleResult> {
  const reprocessBacklog = options.reprocessBacklog ?? true;

  if (pollCycleInFlight) {
    logger.info("Poll cycle skipped — already in progress", { tenantId });
    return pollCycleInFlight;
  }

  const cycle = runPollCycleInner(tenantId, reprocessBacklog);
  pollCycleInFlight = cycle.finally(() => {
    pollCycleInFlight = null;
  });
  return cycle;
}

async function runPollCycleInner(
  tenantId: string,
  reprocessBacklog: boolean
): Promise<PollCycleResult> {
  logger.info("Poll cycle started", { tenantId, reprocessBacklog });

  const connectors = createConnectors();
  let eventsIngested = 0;
  let eventsProcessed = 0;
  let aiReprocessed = 0;

  const bySource: Record<
    DataSource,
    { ingested: number; processed: number; reprocessed: number; stored: number }
  > = {
    slack: { ingested: 0, processed: 0, reprocessed: 0, stored: 0 },
    gmail: { ingested: 0, processed: 0, reprocessed: 0, stored: 0 },
    transcript: { ingested: 0, processed: 0, reprocessed: 0, stored: 0 },
  };

  for (const connector of connectors) {
    const cursor = await cursorRepo.getCursor(connector.source, tenantId);
    const result = await connector.poll(cursor);

    bySource[connector.source].ingested = result.events.length;
    eventsIngested += result.events.length;

    if (result.events.length > 0) {
      logger.info("Ingesting new messages (store only, AI deferred)", {
        source: connector.source,
        count: result.events.length,
      });
      const stored = await processBatch(result.events);
      bySource[connector.source].processed = stored;
      eventsProcessed += stored;
    }

    if (reprocessBacklog) {
      const reprocess = await reprocessUnprocessed(tenantId, connector.source);
      bySource[connector.source].reprocessed = reprocess.processed;
      aiReprocessed += reprocess.processed;
    } else {
      const pending = await messageRepo.countUnprocessedMessages(tenantId, connector.source);
      if (pending > 0) {
        logger.info("AI backlog deferred", {
          source: connector.source,
          pending,
          hint: "Runs on scheduled poll; set AI_REPROCESS_ON_STARTUP=true to run on boot",
        });
      }
    }

    bySource[connector.source].stored = await messageRepo.countMessagesBySource(
      tenantId,
      connector.source
    );

    await cursorRepo.saveCursor(connector.source, tenantId, result.nextCursor);

    logger.info("Poll complete", {
      source: connector.source,
      fetched: result.events.length,
      newlyStored: bySource[connector.source].processed,
      aiProcessed: bySource[connector.source].reprocessed,
      aiLimitPerPoll: config.AI_REPROCESS_PER_POLL,
      stored: bySource[connector.source].stored,
    });
  }

  logger.info("Poll cycle finished", {
    tenantId,
    eventsIngested,
    eventsProcessed,
    aiReprocessed,
  });

  return {
    sourcesPolled: connectors.length,
    eventsIngested,
    eventsProcessed,
    aiReprocessed,
    bySource,
  };
}
