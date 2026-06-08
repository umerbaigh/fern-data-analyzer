import { Router } from "express";
import * as topicRepo from "../db/repositories/topic.repository";
import type { DataSource } from "../types/events";

export const topicsRouter = Router();

topicsRouter.get("/:tenantId", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const source = req.query.source as DataSource | undefined;
    const topics = await topicRepo.listTopics(req.params.tenantId, source, limit);
    res.json({ source: source ?? "all", topics });
  } catch (err) {
    next(err);
  }
});
