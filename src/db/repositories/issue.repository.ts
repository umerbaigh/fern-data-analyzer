import { v4 as uuidv4 } from "uuid";
import { query, queryOne } from "../client";
import type { DataSource } from "../../types/events";
import type { ExtractedIssue, Issue, IssueStatus } from "../../types/issues";

interface IssueRow {
  id: string;
  tenant_id: string;
  source: string;
  title: string;
  summary: string | null;
  status: IssueStatus;
  owner_guess: string | null;
  topic_id: string | null;
  confidence: number;
  evidence_message_ids: string[];
  blockers: string[];
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

function toIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source as DataSource,
    title: row.title,
    summary: row.summary,
    status: row.status,
    ownerGuess: row.owner_guess,
    topicId: row.topic_id,
    confidence: row.confidence,
    evidenceMessageIds: row.evidence_message_ids,
    blockers: row.blockers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export async function createIssue(
  tenantId: string,
  source: DataSource,
  extracted: ExtractedIssue,
  topicId?: string
): Promise<Issue> {
  const id = uuidv4();
  const row = await queryOne<IssueRow>(
    `INSERT INTO issues (id, tenant_id, source, title, status, owner_guess, topic_id, confidence, evidence_message_ids, blockers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      tenantId,
      source,
      extracted.title,
      extracted.status,
      extracted.ownerGuess,
      topicId ?? null,
      extracted.confidence,
      extracted.evidenceMessageIds,
      extracted.blockers,
    ]
  );

  if (!row) throw new Error("Failed to create issue");
  return toIssue(row);
}

export async function updateIssue(
  issueId: string,
  updates: Partial<{
    status: IssueStatus;
    ownerGuess: string | null;
    evidenceMessageIds: string[];
    blockers: string[];
    confidence: number;
    summary: string;
  }>
): Promise<Issue | null> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [issueId];
  let idx = 2;

  if (updates.status) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
    if (updates.status === "resolved") {
      sets.push("resolved_at = NOW()");
    }
  }
  if (updates.ownerGuess !== undefined) {
    sets.push(`owner_guess = $${idx++}`);
    params.push(updates.ownerGuess);
  }
  if (updates.evidenceMessageIds) {
    sets.push(`evidence_message_ids = $${idx++}`);
    params.push(updates.evidenceMessageIds);
  }
  if (updates.blockers) {
    sets.push(`blockers = $${idx++}`);
    params.push(updates.blockers);
  }
  if (updates.confidence !== undefined) {
    sets.push(`confidence = $${idx++}`);
    params.push(updates.confidence);
  }
  if (updates.summary) {
    sets.push(`summary = $${idx++}`);
    params.push(updates.summary);
  }

  const row = await queryOne<IssueRow>(
    `UPDATE issues SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );

  return row ? toIssue(row) : null;
}

export async function listIssues(
  tenantId: string,
  status?: IssueStatus,
  source?: DataSource
): Promise<Issue[]> {
  const params: unknown[] = [tenantId];
  let sql = `SELECT * FROM issues WHERE tenant_id = $1`;
  let idx = 2;

  if (status) {
    sql += ` AND status = $${idx++}`;
    params.push(status);
  }
  if (source) {
    sql += ` AND source = $${idx++}`;
    params.push(source);
  }

  sql += ` ORDER BY updated_at DESC`;
  const rows = await query<IssueRow>(sql, params);
  return rows.map(toIssue);
}

export async function findStaleIssues(
  tenantId: string,
  staleDays = 14,
  source?: DataSource
): Promise<Issue[]> {
  const params: unknown[] = [tenantId, staleDays];
  let sql = `SELECT * FROM issues
     WHERE tenant_id = $1
       AND status IN ('open', 'in_progress')
       AND updated_at < NOW() - ($2 || ' days')::INTERVAL`;

  if (source) {
    sql += ` AND source = $3`;
    params.push(source);
  }

  const rows = await query<IssueRow>(sql, params);
  return rows.map(toIssue);
}
