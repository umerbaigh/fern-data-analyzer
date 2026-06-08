export type IssueStatus = "open" | "in_progress" | "resolved" | "stale";

export interface ExtractedIssue {
  title: string;
  status: IssueStatus;
  ownerGuess: string | null;
  blockers: string[];
  evidenceMessageIds: string[];
  confidence: number;
}

import type { DataSource } from "./events";

export interface Issue {
  id: string;
  tenantId: string;
  source: DataSource;
  title: string;
  summary: string | null;
  status: IssueStatus;
  ownerGuess: string | null;
  topicId: string | null;
  confidence: number;
  evidenceMessageIds: string[];
  blockers: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}
