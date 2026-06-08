import { normalizeEvent } from "../pipeline/normalizer";
import { redactText } from "../pipeline/redactor";
import * as messageRepo from "../db/repositories/message.repository";
import { analyzeAndStore } from "./analysis.service";
import { config } from "../config";
import type { DataSource, ProcessedEvent, RawEvent } from "../types/events";
import { logger } from "../utils/logger";

export async function processStoredMessage(
  message: ProcessedEvent,
  options?: { claimed?: boolean }
): Promise<{
  topicId: string | null;
  issueCreated: boolean;
  skipped: boolean;
}> {
  if (!config.GOOGLE_AI_API_KEY) {
    logger.warn("AI skipped — GOOGLE_AI_API_KEY not set", { messageId: message.id });
    return { topicId: null, issueCreated: false, skipped: true };
  }

  if (!options?.claimed) {
    const alreadyProcessed = await messageRepo.isMessageAiProcessed(message.id, message.source);
    if (alreadyProcessed) {
      logger.info("AI skipped — already processed", {
        messageId: message.id,
        source: message.source,
        externalId: message.externalId,
      });
      return { topicId: null, issueCreated: false, skipped: true };
    }
    await messageRepo.markMessageAiProcessed(message.id, message.source);
  }

  logger.info("AI processing started", {
    messageId: message.id,
    source: message.source,
    externalId: message.externalId,
  });

  try {
    const result = await analyzeAndStore(message);
    return { topicId: result.topicId, issueCreated: !!result.issueId, skipped: false };
  } catch (err) {
    await messageRepo.releaseMessageAiClaim(message.id, message.source);
    logger.error("AI processing failed — message stays in DB without topic/issue", {
      messageId: message.id,
      source: message.source,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function storeEvent(event: RawEvent): Promise<ProcessedEvent> {
  const normalized = normalizeEvent(event);
  const redactedText = redactText(normalized.text);

  logger.info("Storing message", {
    source: normalized.source,
    externalId: normalized.externalId,
  });

  return messageRepo.insertMessage(normalized, redactedText);
}

/** Store only — AI runs later via reprocessUnprocessed (capped by AI_REPROCESS_PER_POLL). */
export async function processBatch(events: RawEvent[]): Promise<number> {
  let stored = 0;
  for (const event of events) {
    try {
      await storeEvent(event);
      stored++;
    } catch (err) {
      logger.error("Failed to store event", {
        externalId: event.externalId,
        source: event.source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return stored;
}

export async function reprocessUnprocessed(
  tenantId: string,
  source?: DataSource,
  limit = config.AI_REPROCESS_PER_POLL
): Promise<{ processed: number; skipped: number; errors: number }> {
  const sources: DataSource[] = source
    ? [source]
    : ["slack", "gmail", "transcript"];

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const src of sources) {
    const pending = await messageRepo.countUnprocessedMessages(tenantId, src);
    if (pending === 0) {
      logger.info("Reprocess queue — nothing pending", { tenantId, source: src });
      continue;
    }

    const claimed = await messageRepo.claimMessagesForAi(tenantId, src, limit);
    logger.info("Reprocess queue — claimed batch", {
      tenantId,
      source: src,
      pending,
      claimed: claimed.length,
      limit,
    });

    for (const message of claimed) {
      try {
        const result = await processStoredMessage(message, { claimed: true });
        if (!result.skipped) {
          processed++;
        }
      } catch (err) {
        errors++;
        await messageRepo.releaseMessageAiClaim(message.id, message.source);
        logger.error("Reprocess failed — released claim, will retry next poll", {
          messageId: message.id,
          source: message.source,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (processed === 0 && errors === 0) {
    skipped = 1;
    logger.info("No unprocessed messages found", { tenantId, source: source ?? "all" });
  }

  return { processed, skipped, errors };
}
