import { google } from "googleapis";
import { config } from "../config";
import type { Connector } from "./base";
import type { ConnectorResult, PollCursor, RawEvent } from "../types/events";
import { logger } from "../utils/logger";

interface GmailCursor {
  historyId?: string;
  initialBackfillDone?: boolean;
}

export interface GmailMessagePreview {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  body: string;
  occurredAt: string;
}

export class GmailConnector implements Connector {
  source = "gmail" as const;

  private getClient() {
    if (!config.GMAIL_CLIENT_ID || !config.GMAIL_CLIENT_SECRET || !config.GMAIL_REFRESH_TOKEN) {
      return null;
    }

    const oauth2 = new google.auth.OAuth2(
      config.GMAIL_CLIENT_ID,
      config.GMAIL_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: config.GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: "v1", auth: oauth2 });
  }

  async getStatus(): Promise<{ connected: boolean; email?: string }> {
    const gmail = this.getClient();
    if (!gmail) {
      return { connected: false };
    }

    const userId = config.GMAIL_USER_EMAIL ?? "me";
    const profile = await gmail.users.getProfile({ userId });
    return {
      connected: true,
      email: profile.data.emailAddress ?? undefined,
    };
  }

  async listMessages(limit = 20): Promise<GmailMessagePreview[]> {
    const gmail = this.getClient();
    if (!gmail) {
      throw new Error(
        "Gmail OAuth not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env"
      );
    }

    const userId = config.GMAIL_USER_EMAIL ?? "me";
    const list = await gmail.users.messages.list({
      userId,
      maxResults: Math.min(limit, 50),
    });

    const messages: GmailMessagePreview[] = [];

    for (const item of list.data.messages ?? []) {
      if (!item.id) continue;
      const preview = await this.fetchMessagePreview(gmail, userId, item.id);
      if (preview) messages.push(preview);
    }

    return messages;
  }

  async poll(pollCursor: PollCursor): Promise<ConnectorResult> {
    const gmail = this.getClient();
    if (!gmail) {
      logger.warn("Gmail connector skipped — OAuth credentials not set");
      return { events: [], nextCursor: pollCursor.cursor };
    }

    const cursor = (pollCursor.cursor as unknown as GmailCursor) ?? {};
    const userId = config.GMAIL_USER_EMAIL ?? "me";

    try {
      const profile = await gmail.users.getProfile({ userId });
      const currentHistoryId = profile.data.historyId ?? "0";

      // First poll: backfill recent inbox (preview API behavior)
      if (!cursor.initialBackfillDone) {
        const events = await this.fetchRecentAsEvents(
          gmail,
          userId,
          pollCursor.tenantId,
          config.GMAIL_POLL_BACKFILL_LIMIT
        );

        logger.info("Gmail initial backfill", { count: events.length });

        return {
          events,
          nextCursor: {
            historyId: currentHistoryId,
            initialBackfillDone: true,
          },
        };
      }

      // Later polls: only new mail since last historyId
      if (!cursor.historyId) {
        return {
          events: [],
          nextCursor: { historyId: currentHistoryId, initialBackfillDone: true },
        };
      }

      const events: RawEvent[] = [];
      const history = await gmail.users.history.list({
        userId,
        startHistoryId: cursor.historyId,
        historyTypes: ["messageAdded"],
      });

      const histories = history.data.history ?? [];
      let latestHistoryId = cursor.historyId;

      for (const entry of histories) {
        if (entry.id) latestHistoryId = entry.id;
        for (const added of entry.messagesAdded ?? []) {
          const msgId = added.message?.id;
          if (!msgId) continue;

          const event = await this.fetchMessageAsEvent(gmail, userId, msgId, pollCursor.tenantId);
          if (event) events.push(event);
        }
      }

      return {
        events,
        nextCursor: { historyId: latestHistoryId, initialBackfillDone: true },
      };
    } catch (err) {
      logger.error("Gmail poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { events: [], nextCursor: pollCursor.cursor };
    }
  }

  private async fetchRecentAsEvents(
    gmail: ReturnType<typeof google.gmail>,
    userId: string,
    tenantId: string,
    limit: number
  ): Promise<RawEvent[]> {
    const list = await gmail.users.messages.list({
      userId,
      maxResults: Math.min(limit, 50),
    });

    const events: RawEvent[] = [];
    for (const item of list.data.messages ?? []) {
      if (!item.id) continue;
      const event = await this.fetchMessageAsEvent(gmail, userId, item.id, tenantId);
      if (event) events.push(event);
    }
    return events;
  }

  private async fetchMessageAsEvent(
    gmail: ReturnType<typeof google.gmail>,
    userId: string,
    msgId: string,
    tenantId: string
  ): Promise<RawEvent | null> {
    const full = await gmail.users.messages.get({
      userId,
      id: msgId,
      format: "full",
    });

    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const from = headers.find((h) => h.name === "From")?.value ?? "unknown";
    const to = headers.find((h) => h.name === "To")?.value ?? "";
    const threadId = full.data.threadId ?? msgId;
    const body = extractBody(full.data.payload as GmailPayload) || full.data.snippet || "";

    return {
      externalId: `gmail:${msgId}`,
      tenantId,
      source: "gmail",
      occurredAt: new Date(parseInt(full.data.internalDate ?? "0", 10)),
      participants: [from, ...to.split(",").map((s) => s.trim())].filter(Boolean),
      threadId: `gmail:${threadId}`,
      text: `Subject: ${subject}\n\n${body}`,
      metadata: { subject, from, to, threadId },
    };
  }

  private async fetchMessagePreview(
    gmail: ReturnType<typeof google.gmail>,
    userId: string,
    msgId: string
  ): Promise<GmailMessagePreview | null> {
    const full = await gmail.users.messages.get({
      userId,
      id: msgId,
      format: "full",
    });

    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const from = headers.find((h) => h.name === "From")?.value ?? "unknown";
    const to = headers.find((h) => h.name === "To")?.value ?? "";
    const body = extractBody(full.data.payload as GmailPayload) || full.data.snippet || "";

    return {
      id: msgId,
      threadId: full.data.threadId ?? msgId,
      subject,
      from,
      to,
      snippet: full.data.snippet ?? "",
      body: body.slice(0, 500),
      occurredAt: new Date(parseInt(full.data.internalDate ?? "0", 10)).toISOString(),
    };
  }
}

interface GmailPayload {
  body?: { data?: string | null };
  parts?: Array<{ mimeType?: string | null; body?: { data?: string | null } }>;
}

function extractBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf-8");
    }
  }
  return "";
}
