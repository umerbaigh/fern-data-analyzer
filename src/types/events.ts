export type DataSource = "slack" | "gmail" | "transcript";

export interface RawEvent {
  externalId: string;
  tenantId: string;
  source: DataSource;
  occurredAt: Date;
  participants: string[];
  threadId: string | null;
  text: string;
  metadata: Record<string, unknown>;
}

export interface ProcessedEvent extends RawEvent {
  id: string;
  redactedText: string;
  ingestedAt: Date;
}

export interface PollCursor {
  source: DataSource;
  tenantId: string;
  cursor: Record<string, unknown>;
  updatedAt: Date;
}

export interface ConnectorResult {
  events: RawEvent[];
  nextCursor: Record<string, unknown>;
}
