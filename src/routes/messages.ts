import { Router } from "express";
import * as messageRepo from "../db/repositories/message.repository";
import type { DataSource } from "../types/events";

export const messagesRouter = Router();

messagesRouter.get("/:tenantId/summary", async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const [slack, gmail, transcript] = await Promise.all([
      messageRepo.countMessagesBySource(tenantId, "slack"),
      messageRepo.countMessagesBySource(tenantId, "gmail"),
      messageRepo.countMessagesBySource(tenantId, "transcript"),
    ]);

    res.json({
      tenantId,
      counts: { slack, gmail, transcript, total: slack + gmail + transcript },
    });
  } catch (err) {
    next(err);
  }
});

messagesRouter.get("/:tenantId/slack", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await messageRepo.listMessagesBySource(
      req.params.tenantId,
      "slack",
      limit
    );
    res.json({ source: "slack", messages });
  } catch (err) {
    next(err);
  }
});

messagesRouter.get("/:tenantId/gmail", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await messageRepo.listMessagesBySource(
      req.params.tenantId,
      "gmail",
      limit
    );
    res.json({ source: "gmail", messages });
  } catch (err) {
    next(err);
  }
});

messagesRouter.get("/:tenantId/transcripts", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await messageRepo.listMessagesBySource(
      req.params.tenantId,
      "transcript",
      limit
    );
    res.json({ source: "transcript", messages });
  } catch (err) {
    next(err);
  }
});

messagesRouter.get("/:tenantId/:source", async (req, res, next) => {
  try {
    const source = req.params.source as DataSource;
    if (!["slack", "gmail", "transcript"].includes(source)) {
      res.status(400).json({ error: "Invalid source. Use slack, gmail, or transcript." });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await messageRepo.listMessagesBySource(
      req.params.tenantId,
      source,
      limit
    );
    res.json({ source, messages });
  } catch (err) {
    next(err);
  }
});
