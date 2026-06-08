import { Router } from "express";
import { config } from "../config";
import { reprocessUnprocessed } from "../services/processor.service";
import type { DataSource } from "../types/events";

export const processRouter = Router();

processRouter.post("/:tenantId/reprocess", async (req, res, next) => {
  try {
    const source = req.query.source as DataSource | undefined;
    const requested = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(requested, config.AI_REPROCESS_PER_POLL)
      : config.AI_REPROCESS_PER_POLL;

    if (source && !["slack", "gmail", "transcript"].includes(source)) {
      res.status(400).json({ error: "Invalid source. Use slack, gmail, or transcript." });
      return;
    }

    const result = await reprocessUnprocessed(req.params.tenantId, source, limit);
    res.json({ tenantId: req.params.tenantId, source: source ?? "all", ...result });
  } catch (err) {
    next(err);
  }
});
