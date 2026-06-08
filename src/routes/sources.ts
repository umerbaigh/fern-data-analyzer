import { Router } from "express";
import { SlackConnector } from "../connectors/slack.connector";
import { GmailConnector } from "../connectors/gmail.connector";

export const sourcesRouter = Router();

const slack = new SlackConnector();
const gmail = new GmailConnector();

sourcesRouter.get("/slack/status", async (_req, res, next) => {
  try {
    res.json(await slack.getStatus());
  } catch (err) {
    next(err);
  }
});

sourcesRouter.get("/slack/channels", async (_req, res, next) => {
  try {
    const channels = await slack.listChannels();
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

sourcesRouter.get("/slack/messages", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const channelId = req.query.channel as string | undefined;
    const messages = await slack.listMessages({ channelId, limit });
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

sourcesRouter.get("/gmail/status", async (_req, res, next) => {
  try {
    res.json(await gmail.getStatus());
  } catch (err) {
    next(err);
  }
});

sourcesRouter.get("/gmail/messages", async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = await gmail.listMessages(limit);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});
