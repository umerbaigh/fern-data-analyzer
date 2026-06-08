import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { config } from "../config";
import { runPollCycle } from "../services/poll.service";
import { processBatch } from "../services/processor.service";
import { generateRecommendations } from "../services/recommendation.service";
import { markStaleIssues } from "../services/issue.service";
import type { RawEvent } from "../types/events";
import type { Recommendation } from "../types/recommendations";
import { logger } from "../utils/logger";

const connection: ConnectionOptions = {
  url: config.REDIS_URL,
  maxRetriesPerRequest: null,
};

export const ingestQueue = new Queue("fern-ingest", { connection });
export const processQueue = new Queue("fern-process", { connection });

export interface PollJobData {
  tenantId: string;
}

export interface ProcessJobData {
  events: RawEvent[];
}

export async function enqueuePoll(tenantId: string): Promise<void> {
  await ingestQueue.add("poll", { tenantId }, { removeOnComplete: 100, removeOnFail: 50 });
}

export async function enqueueProcess(events: RawEvent[]): Promise<void> {
  if (!events.length) return;
  await processQueue.add("process", { events }, { removeOnComplete: 100, removeOnFail: 50 });
}

export function startWorkers(): void {
  new Worker<PollJobData>(
    "fern-ingest",
    async (job: Job<PollJobData>) => {
      const result = await runPollCycle(job.data.tenantId);
      await markStaleIssues(job.data.tenantId);
      return result;
    },
    { connection, concurrency: 1 }
  );

  new Worker<ProcessJobData>(
    "fern-process",
    async (job: Job<ProcessJobData>) => {
      return { processed: await processBatch(job.data.events) };
    },
    { connection, concurrency: 10 }
  );

  logger.info("BullMQ workers started");
}

export async function enqueueRecommendations(
  tenantId: string,
  userId: string
): Promise<Recommendation[]> {
  return generateRecommendations(tenantId, userId);
}
