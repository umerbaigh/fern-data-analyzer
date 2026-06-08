import * as issueRepo from "../db/repositories/issue.repository";
import * as messageRepo from "../db/repositories/message.repository";
import * as topicRepo from "../db/repositories/topic.repository";
import { analyzeMessage } from "./llm.service";
import type { ProcessedEvent } from "../types/events";
import type { Issue } from "../types/issues";
import type { TopicClassification } from "./llm.service";
import type { ExtractedIssue } from "../types/issues";
import { logger } from "../utils/logger";

const TOPIC_CANDIDATE_LIMIT = 50;
const CREATE_CONFIDENCE_THRESHOLD = 0.55;

export async function analyzeAndStore(message: ProcessedEvent): Promise<{
  topicId: string | null;
  issueId: string | null;
}> {
  const existingTopics = await topicRepo.listTopics(
    message.tenantId,
    message.source,
    TOPIC_CANDIDATE_LIMIT
  );

  const context = message.threadId
    ? await messageRepo.findThreadMessages(
        message.tenantId,
        message.threadId,
        message.source,
        10
      )
    : [];

  const contextTexts = context.map((m) => m.redactedText);

  logger.info("AI: analyzing message (1 Gemini call)", {
    messageId: message.id,
    source: message.source,
    existingTopicCount: existingTopics.length,
  });

  const analysis = await analyzeMessage(
    message.redactedText,
    message.id,
    existingTopics,
    contextTexts
  );

  const topicId = await applyTopic(message, analysis.topic, existingTopics);
  const issue = await applyIssue(message, analysis.issue, topicId);

  logger.info("AI: saved to database", {
    messageId: message.id,
    source: message.source,
    topicId,
    issueId: issue?.id ?? null,
  });

  return { topicId, issueId: issue?.id ?? null };
}

async function applyTopic(
  message: ProcessedEvent,
  classification: TopicClassification,
  existingTopics: Awaited<ReturnType<typeof topicRepo.listTopics>>
): Promise<string | null> {
  if (classification.action === "assign" && classification.topicId) {
    const exists = existingTopics.some((t) => t.id === classification.topicId);
    if (exists) {
      await topicRepo.assignMessageToTopic(
        message.id,
        message.source,
        classification.topicId,
        classification.confidence
      );
      logger.info("AI: topic assigned in DB", {
        messageId: message.id,
        topicId: classification.topicId,
      });
      return classification.topicId;
    }
  }

  const summary = classification.newTopic;
  if (!summary?.label) {
    logger.warn("AI: no topic created — missing newTopic from Gemini", {
      messageId: message.id,
    });
    return null;
  }

  const topic = await topicRepo.createTopic(
    message.tenantId,
    message.source,
    summary.label,
    summary.summary,
    summary.keywords
  );
  await topicRepo.assignMessageToTopic(
    message.id,
    message.source,
    topic.id,
    classification.confidence || 1.0
  );

  logger.info("AI: topic created in DB", {
    messageId: message.id,
    topicId: topic.id,
    label: topic.label,
  });

  return topic.id;
}

async function applyIssue(
  message: ProcessedEvent,
  extracted: ExtractedIssue | null,
  topicId: string | null
): Promise<Issue | null> {
  if (!extracted || extracted.confidence < CREATE_CONFIDENCE_THRESHOLD) {
    logger.info("AI: no issue saved", {
      messageId: message.id,
      confidence: extracted?.confidence ?? 0,
    });
    return null;
  }

  if (extracted.status === "resolved") return null;

  const openIssues = await issueRepo.listIssues(message.tenantId, undefined, message.source);
  const activeIssues = openIssues.filter((i) =>
    ["open", "in_progress"].includes(i.status)
  );

  const existing = activeIssues.find(
    (i) => i.title.toLowerCase() === extracted.title.toLowerCase()
  );

  if (existing) {
    const mergedEvidence = [
      ...new Set([...existing.evidenceMessageIds, ...extracted.evidenceMessageIds]),
    ];
    const updated = await issueRepo.updateIssue(existing.id, {
      ownerGuess: extracted.ownerGuess ?? existing.ownerGuess,
      blockers: [...new Set([...existing.blockers, ...extracted.blockers])],
      evidenceMessageIds: mergedEvidence,
      confidence: Math.max(existing.confidence, extracted.confidence),
    });
    logger.info("AI: issue updated in DB", { issueId: existing.id });
    return updated;
  }

  const issue = await issueRepo.createIssue(
    message.tenantId,
    message.source,
    extracted,
    topicId ?? undefined
  );
  logger.info("AI: issue created in DB", { issueId: issue.id, title: issue.title });
  return issue;
}
