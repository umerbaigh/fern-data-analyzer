export type RecommendationType =
  | "follow_up"
  | "risk"
  | "synthesis"
  | "cleanup";

export interface Recommendation {
  id: string;
  tenantId: string;
  userId: string;
  type: RecommendationType;
  title: string;
  body: string;
  evidenceMessageIds: string[];
  issueId: string | null;
  topicId: string | null;
  priority: number;
  createdAt: Date;
  dismissedAt: Date | null;
}
