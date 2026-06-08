import type { DataSource } from "./events";

export interface Topic {
  id: string;
  tenantId: string;
  source: DataSource;
  label: string;
  summary: string | null;
  keywords: string[];
  messageCount: number;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface MessageTopic {
  messageId: string;
  source: DataSource;
  topicId: string;
  confidence: number;
}
