import { WebClient } from "@slack/web-api";
import { config, getSlackChannels } from "../config";
import type { Connector } from "./base";
import type { ConnectorResult, PollCursor, RawEvent } from "../types/events";
import { logger } from "../utils/logger";

interface SlackCursor {
  channelCursors: Record<string, string>;
}

export interface SlackChannelPreview {
  id: string;
  name: string;
  isPrivate: boolean;
  numMembers?: number;
}

export interface SlackMessagePreview {
  channelId: string;
  channelName?: string;
  user: string;
  text: string;
  ts: string;
  threadTs: string | null;
  occurredAt: string;
}

export class SlackConnector implements Connector {
  source = "slack" as const;
  private client: WebClient | null;

  constructor() {
    this.client = config.SLACK_BOT_TOKEN
      ? new WebClient(config.SLACK_BOT_TOKEN)
      : null;
  }

  async getStatus(): Promise<{ connected: boolean; configuredChannels: string[] }> {
    if (!this.client) {
      return { connected: false, configuredChannels: getSlackChannels() };
    }

    await this.client.auth.test();
    return { connected: true, configuredChannels: getSlackChannels() };
  }

  async listChannels(): Promise<SlackChannelPreview[]> {
    if (!this.client) {
      throw new Error("SLACK_BOT_TOKEN is not set in .env");
    }

    const channels: SlackChannelPreview[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      for (const channel of response.channels ?? []) {
        if (!channel.id || !channel.name) continue;
        channels.push({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private ?? false,
          numMembers: channel.num_members,
        });
      }

      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listMessages(options: {
    channelId?: string;
    limit?: number;
  } = {}): Promise<SlackMessagePreview[]> {
    if (!this.client) {
      throw new Error("SLACK_BOT_TOKEN is not set in .env");
    }

    const limit = options.limit ?? 20;
    const channelIds = options.channelId
      ? [options.channelId]
      : getSlackChannels();

    if (!channelIds.length) {
      throw new Error(
        "No channels configured. Set SLACK_CHANNELS in .env or pass ?channel=CHANNEL_ID"
      );
    }

    const messages: SlackMessagePreview[] = [];

    for (const channelId of channelIds) {
      const response = await this.client.conversations.history({
        channel: channelId,
        limit: Math.min(limit, 200),
      });

      let channelName: string | undefined;
      try {
        const info = await this.client.conversations.info({ channel: channelId });
        channelName = info.channel?.name;
      } catch {
        channelName = channelId;
      }

      for (const msg of response.messages ?? []) {
        if (!msg.text || msg.subtype) continue;
        messages.push({
          channelId,
          channelName,
          user: msg.user ?? "unknown",
          text: msg.text,
          ts: msg.ts!,
          threadTs: msg.thread_ts ?? null,
          occurredAt: new Date(parseFloat(msg.ts!) * 1000).toISOString(),
        });
      }
    }

    return messages
      .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts))
      .slice(0, limit);
  }

  async poll(pollCursor: PollCursor): Promise<ConnectorResult> {
    if (!this.client) {
      logger.warn("Slack connector skipped — SLACK_BOT_TOKEN not set");
      return { events: [], nextCursor: pollCursor.cursor };
    }

    const channels = getSlackChannels();
    const stored = (pollCursor.cursor as unknown as SlackCursor) ?? {};
    const channelCursors = stored.channelCursors ?? {};
    const events: RawEvent[] = [];
    const nextChannelCursors: Record<string, string> = { ...channelCursors };

    for (const channelId of channels) {
      try {
        const oldest = channelCursors[channelId];
        const response = await this.client.conversations.history({
          channel: channelId,
          oldest,
          limit: 200,
          inclusive: false,
        });

        const messages = response.messages ?? [];
        for (const msg of messages.reverse()) {
          if (!msg.text || msg.subtype) continue;
          if (config.EXCLUDE_DM_CHANNELS && channelId.startsWith("D")) continue;

          events.push({
            externalId: `slack:${channelId}:${msg.ts}`,
            tenantId: pollCursor.tenantId,
            source: "slack",
            occurredAt: new Date(parseFloat(msg.ts!) * 1000),
            participants: [msg.user ?? "unknown"],
            threadId: msg.thread_ts
              ? `slack:${channelId}:${msg.thread_ts}`
              : null,
            text: msg.text,
            metadata: {
              channel: channelId,
              ts: msg.ts,
              threadTs: msg.thread_ts ?? null,
            },
          });
        }

        if (messages.length > 0) {
          const latest = messages[messages.length - 1];
          if (latest.ts) nextChannelCursors[channelId] = latest.ts;
        }
      } catch (err) {
        logger.error("Slack poll failed for channel", {
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      events,
      nextCursor: { channelCursors: nextChannelCursors },
    };
  }
}
