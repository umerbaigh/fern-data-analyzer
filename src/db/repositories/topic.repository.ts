import { v4 as uuidv4 } from "uuid";
import { query, queryOne } from "../client";
import type { DataSource } from "../../types/events";
import type { Topic } from "../../types/topics";

interface TopicRow {
  id: string;
  tenant_id: string;
  source: string;
  label: string;
  summary: string | null;
  keywords: string[];
  message_count: number;
  last_seen_at: Date;
  created_at: Date;
}

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source as DataSource,
    label: row.label,
    summary: row.summary,
    keywords: row.keywords,
    messageCount: row.message_count,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export async function createTopic(
  tenantId: string,
  source: DataSource,
  label: string,
  summary?: string,
  keywords: string[] = []
): Promise<Topic> {
  const id = uuidv4();

  const row = await queryOne<TopicRow>(
    `INSERT INTO topics (id, tenant_id, source, label, summary, keywords, message_count, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, NOW())
     RETURNING *`,
    [id, tenantId, source, label, summary ?? null, keywords]
  );

  if (!row) throw new Error("Failed to create topic");
  return toTopic(row);
}

export async function assignMessageToTopic(
  messageId: string,
  source: DataSource,
  topicId: string,
  confidence: number
): Promise<void> {
  await queryOne(
    `INSERT INTO message_topics (message_id, source, topic_id, confidence)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, topic_id) DO UPDATE SET confidence = $4`,
    [messageId, source, topicId, confidence]
  );

  await queryOne(
    `UPDATE topics SET message_count = message_count + 1, last_seen_at = NOW() WHERE id = $1`,
    [topicId]
  );
}

export async function getTopicById(topicId: string): Promise<Topic | null> {
  const row = await queryOne<TopicRow>(`SELECT * FROM topics WHERE id = $1`, [topicId]);
  return row ? toTopic(row) : null;
}

export async function listTopics(
  tenantId: string,
  source?: DataSource,
  limit = 50
): Promise<Topic[]> {
  const params: unknown[] = [tenantId];
  let sql = `SELECT * FROM topics WHERE tenant_id = $1`;

  if (source) {
    sql += ` AND source = $2`;
    params.push(source);
    params.push(limit);
    sql += ` ORDER BY last_seen_at DESC LIMIT $3`;
  } else {
    params.push(limit);
    sql += ` ORDER BY last_seen_at DESC LIMIT $2`;
  }

  const rows = await query<TopicRow>(sql, params);
  return rows.map(toTopic);
}

export async function updateTopicSummary(
  topicId: string,
  label: string,
  summary: string,
  keywords: string[]
): Promise<void> {
  await queryOne(
    `UPDATE topics SET label = $2, summary = $3, keywords = $4 WHERE id = $1`,
    [topicId, label, summary, keywords]
  );
}
