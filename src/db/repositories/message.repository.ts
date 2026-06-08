import { v4 as uuidv4 } from "uuid";
import { query, queryOne } from "../client";
import type { DataSource, ProcessedEvent, RawEvent } from "../../types/events";

const SOURCE_TABLES: Record<DataSource, string> = {
  slack: "slack_messages",
  gmail: "gmail_messages",
  transcript: "transcript_messages",
};

interface MessageRow {
  id: string;
  external_id: string;
  tenant_id: string;
  occurred_at: Date;
  participants: string[];
  thread_id: string | null;
  raw_text: string;
  redacted_text: string;
  metadata: Record<string, unknown>;
  ingested_at: Date;
  ai_processed_at: Date | null;
}

function toProcessedEvent(row: MessageRow, source: DataSource): ProcessedEvent {
  return {
    id: row.id,
    externalId: row.external_id,
    tenantId: row.tenant_id,
    source,
    occurredAt: row.occurred_at,
    participants: row.participants,
    threadId: row.thread_id,
    text: row.raw_text,
    redactedText: row.redacted_text,
    metadata: row.metadata,
    ingestedAt: row.ingested_at,
  };
}

function tableFor(source: DataSource): string {
  return SOURCE_TABLES[source];
}

export async function insertMessage(
  event: RawEvent,
  redactedText: string
): Promise<ProcessedEvent> {
  const id = uuidv4();
  const table = tableFor(event.source);

  const row = await queryOne<MessageRow>(
    `INSERT INTO ${table} (id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, external_id) DO UPDATE SET
       raw_text = EXCLUDED.raw_text,
       redacted_text = EXCLUDED.redacted_text,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    [
      id,
      event.externalId,
      event.tenantId,
      event.occurredAt,
      event.participants,
      event.threadId,
      event.text,
      redactedText,
      JSON.stringify(event.metadata),
    ]
  );

  if (!row) throw new Error(`Failed to insert message into ${table}`);
  return toProcessedEvent(row, event.source);
}

export async function findMessageById(
  id: string,
  source: DataSource
): Promise<ProcessedEvent | null> {
  const table = tableFor(source);
  const row = await queryOne<MessageRow>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return row ? toProcessedEvent(row, source) : null;
}

export async function listMessagesBySource(
  tenantId: string,
  source: DataSource,
  limit = 50
): Promise<ProcessedEvent[]> {
  const table = tableFor(source);
  const rows = await query<MessageRow>(
    `SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
    [tenantId, limit]
  );
  return rows.map((row) => toProcessedEvent(row, source));
}

export async function countMessagesBySource(
  tenantId: string,
  source: DataSource
): Promise<number> {
  const table = tableFor(source);
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  );
  return parseInt(row?.count ?? "0", 10);
}

export async function findRecentMessages(
  tenantId: string,
  limit = 50,
  source?: DataSource
): Promise<ProcessedEvent[]> {
  if (source) {
    return listMessagesBySource(tenantId, source, limit);
  }

  const perSource = Math.max(1, Math.ceil(limit / 3));
  const [slack, gmail, transcript] = await Promise.all([
    listMessagesBySource(tenantId, "slack", perSource),
    listMessagesBySource(tenantId, "gmail", perSource),
    listMessagesBySource(tenantId, "transcript", perSource),
  ]);

  return [...slack, ...gmail, ...transcript]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
}

export async function findThreadMessages(
  tenantId: string,
  threadId: string,
  source: DataSource,
  limit = 20
): Promise<ProcessedEvent[]> {
  const table = tableFor(source);
  const rows = await query<MessageRow>(
    `SELECT * FROM ${table}
     WHERE tenant_id = $1 AND (thread_id = $2 OR external_id = $2)
     ORDER BY occurred_at ASC
     LIMIT $3`,
    [tenantId, threadId, limit]
  );
  return rows.map((row) => toProcessedEvent(row, source));
}

export async function isMessageAiProcessed(
  messageId: string,
  source: DataSource
): Promise<boolean> {
  const table = tableFor(source);
  const row = await queryOne<{ ai_processed_at: Date | null }>(
    `SELECT ai_processed_at FROM ${table} WHERE id = $1`,
    [messageId]
  );
  return row?.ai_processed_at != null;
}

export async function markMessageAiProcessed(
  messageId: string,
  source: DataSource
): Promise<void> {
  const table = tableFor(source);
  await queryOne(
    `UPDATE ${table} SET ai_processed_at = NOW() WHERE id = $1 AND ai_processed_at IS NULL`,
    [messageId]
  );
}

export async function releaseMessageAiClaim(
  messageId: string,
  source: DataSource
): Promise<void> {
  const table = tableFor(source);
  await queryOne(`UPDATE ${table} SET ai_processed_at = NULL WHERE id = $1`, [messageId]);
}

/** Atomically claim messages for AI so concurrent polls cannot pick the same row. */
export async function claimMessagesForAi(
  tenantId: string,
  source: DataSource,
  limit: number
): Promise<ProcessedEvent[]> {
  const table = tableFor(source);
  const rows = await query<MessageRow>(
    `UPDATE ${table} m
     SET ai_processed_at = NOW()
     FROM (
       SELECT id FROM ${table}
       WHERE tenant_id = $1 AND ai_processed_at IS NULL
       ORDER BY occurred_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     ) picked
     WHERE m.id = picked.id
     RETURNING m.*`,
    [tenantId, limit]
  );
  return rows.map((row) => toProcessedEvent(row, source));
}

export async function countUnprocessedMessages(
  tenantId: string,
  source: DataSource
): Promise<number> {
  const table = tableFor(source);
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}
     WHERE tenant_id = $1 AND ai_processed_at IS NULL`,
    [tenantId]
  );
  return parseInt(row?.count ?? "0", 10);
}

export async function findUnprocessedMessages(
  tenantId: string,
  source: DataSource,
  limit = 50
): Promise<ProcessedEvent[]> {
  const table = tableFor(source);
  const rows = await query<MessageRow>(
    `SELECT * FROM ${table}
     WHERE tenant_id = $1 AND ai_processed_at IS NULL
     ORDER BY occurred_at ASC
     LIMIT $2`,
    [tenantId, limit]
  );
  return rows.map((row) => toProcessedEvent(row, source));
}

export async function findMessagesByTopic(
  topicId: string,
  source: DataSource,
  limit = 20
): Promise<ProcessedEvent[]> {
  const table = tableFor(source);
  const rows = await query<MessageRow>(
    `SELECT m.* FROM ${table} m
     JOIN message_topics mt ON mt.message_id = m.id AND mt.source = $3
     WHERE mt.topic_id = $1
     ORDER BY m.occurred_at DESC
     LIMIT $2`,
    [topicId, limit, source]
  );
  return rows.map((row) => toProcessedEvent(row, source));
}
