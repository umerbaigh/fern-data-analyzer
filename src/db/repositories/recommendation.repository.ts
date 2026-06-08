import { v4 as uuidv4 } from "uuid";
import { query, queryOne } from "../client";
import type { Recommendation, RecommendationType } from "../../types/recommendations";

interface RecommendationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  type: RecommendationType;
  title: string;
  body: string;
  evidence_message_ids: string[];
  issue_id: string | null;
  topic_id: string | null;
  priority: number;
  created_at: Date;
  dismissed_at: Date | null;
}

function toRecommendation(row: RecommendationRow): Recommendation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    evidenceMessageIds: row.evidence_message_ids,
    issueId: row.issue_id,
    topicId: row.topic_id,
    priority: row.priority,
    createdAt: row.created_at,
    dismissedAt: row.dismissed_at,
  };
}

export async function createRecommendation(
  tenantId: string,
  userId: string,
  type: RecommendationType,
  title: string,
  body: string,
  options: {
    evidenceMessageIds?: string[];
    issueId?: string;
    topicId?: string;
    priority?: number;
  } = {}
): Promise<Recommendation> {
  const id = uuidv4();
  const row = await queryOne<RecommendationRow>(
    `INSERT INTO recommendations (id, tenant_id, user_id, type, title, body, evidence_message_ids, issue_id, topic_id, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      tenantId,
      userId,
      type,
      title,
      body,
      options.evidenceMessageIds ?? [],
      options.issueId ?? null,
      options.topicId ?? null,
      options.priority ?? 0,
    ]
  );

  if (!row) throw new Error("Failed to create recommendation");
  return toRecommendation(row);
}

export async function listRecommendations(
  tenantId: string,
  userId: string,
  includeDismissed = false
): Promise<Recommendation[]> {
  let sql = `SELECT * FROM recommendations WHERE tenant_id = $1 AND user_id = $2`;
  if (!includeDismissed) {
    sql += ` AND dismissed_at IS NULL`;
  }
  sql += ` ORDER BY priority DESC, created_at DESC`;

  const rows = await query<RecommendationRow>(sql, [tenantId, userId]);
  return rows.map(toRecommendation);
}

export async function dismissRecommendation(id: string): Promise<void> {
  await queryOne(
    `UPDATE recommendations SET dismissed_at = NOW() WHERE id = $1`,
    [id]
  );
}
