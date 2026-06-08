import { queryOne } from "../client";
import type { DataSource, PollCursor } from "../../types/events";

interface CursorRow {
  source: string;
  tenant_id: string;
  cursor: Record<string, unknown>;
  updated_at: Date;
}

export async function getCursor(
  source: DataSource,
  tenantId: string
): Promise<PollCursor> {
  const row = await queryOne<CursorRow>(
    `SELECT * FROM poll_cursors WHERE source = $1 AND tenant_id = $2`,
    [source, tenantId]
  );

  if (!row) {
    return { source, tenantId, cursor: {}, updatedAt: new Date() };
  }

  return {
    source: row.source as DataSource,
    tenantId: row.tenant_id,
    cursor: row.cursor,
    updatedAt: row.updated_at,
  };
}

export async function saveCursor(
  source: DataSource,
  tenantId: string,
  cursor: Record<string, unknown>
): Promise<void> {
  await queryOne(
    `INSERT INTO poll_cursors (source, tenant_id, cursor, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (source, tenant_id) DO UPDATE SET cursor = $3, updated_at = NOW()`,
    [source, tenantId, JSON.stringify(cursor)]
  );
}
