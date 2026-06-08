import * as issueRepo from "../db/repositories/issue.repository";
import * as recommendationRepo from "../db/repositories/recommendation.repository";
import * as messageRepo from "../db/repositories/message.repository";
import * as topicRepo from "../db/repositories/topic.repository";
import { generateRecommendationsWithAI } from "./llm.service";
import type { Recommendation } from "../types/recommendations";

export async function generateRecommendations(
  tenantId: string,
  userId: string
): Promise<Recommendation[]> {
  const [openIssues, staleIssues, recent, topics] = await Promise.all([
    issueRepo.listIssues(tenantId, "open"),
    issueRepo.findStaleIssues(tenantId, 14),
    messageRepo.findRecentMessages(tenantId, 20),
    topicRepo.listTopics(tenantId, undefined, 20),
  ]);

  const mentions = recent
    .filter(
      (m) =>
        m.redactedText.includes(`@${userId}`) ||
        m.participants.some((p) => p.includes(userId))
    )
    .map((m) => ({ id: m.id, text: m.redactedText, source: m.source }));

  const aiRecs = await generateRecommendationsWithAI({
    userId,
    openIssues,
    staleIssues,
    recentMentions: mentions,
    topics,
  });

  const created: Recommendation[] = [];
  for (const rec of aiRecs) {
    const saved = await recommendationRepo.createRecommendation(
      tenantId,
      userId,
      rec.type,
      rec.title,
      rec.body,
      {
        issueId: rec.issueId,
        topicId: rec.topicId,
        priority: rec.priority,
        evidenceMessageIds: rec.evidenceMessageIds,
      }
    );
    created.push(saved);
  }

  return created;
}
