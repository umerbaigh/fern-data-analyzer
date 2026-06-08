import express from "express";
import cors from "cors";
import { config } from "./config";
import { errorHandler } from "./middleware/error-handler";
import { healthRouter } from "./routes/health";
import { topicsRouter } from "./routes/topics";
import { issuesRouter } from "./routes/issues";
import { recommendationsRouter } from "./routes/recommendations";
import { pollRouter } from "./routes/poll";
import { sourcesRouter } from "./routes/sources";
import { messagesRouter } from "./routes/messages";
import { processRouter } from "./routes/process";
import { startPoller } from "./scheduler/poller";
import { startWorkers } from "./queue";
import { runPollCycle } from "./services/poll.service";
import { logGeminiRateLimitConfig } from "./services/llm.service";
import { logger } from "./utils/logger";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/api/topics", topicsRouter);
app.use("/api/issues", issuesRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/poll", pollRouter);
app.use("/api/sources", sourcesRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/process", processRouter);

app.use(errorHandler);

app.listen(config.PORT, () => {
  logger.info("Fern API started", { port: config.PORT, env: config.NODE_ENV });
  if (config.GOOGLE_AI_API_KEY) {
    logGeminiRateLimitConfig();
  }
  if (config.ENABLE_BACKGROUND_JOBS) {
    startWorkers();
    startPoller();
    runPollCycle("default", { reprocessBacklog: config.AI_REPROCESS_ON_STARTUP }).catch((err) => {
      logger.error("Startup poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    logger.info("Background jobs disabled — set ENABLE_BACKGROUND_JOBS=true to enable polling");
  }
});
