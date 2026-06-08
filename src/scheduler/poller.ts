import cron from "node-cron";
import { config } from "../config";
import { enqueuePoll } from "../queue";
import { logger } from "../utils/logger";

const DEFAULT_TENANT = "default";

export function startPoller(): void {
  const minutes = config.POLL_INTERVAL_MINUTES;
  const cronExpr = `*/${minutes} * * * *`;

  cron.schedule(cronExpr, async () => {
    try {
      await enqueuePoll(DEFAULT_TENANT);
      logger.info("Scheduled poll enqueued", { tenantId: DEFAULT_TENANT });
    } catch (err) {
      logger.error("Failed to enqueue poll", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info("Poller scheduled", { intervalMinutes: minutes, cron: cronExpr });
}
