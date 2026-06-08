import * as messageRepo from "../db/repositories/message.repository";
import * as topicRepo from "../db/repositories/topic.repository";
import { classifyTopic, summarizeTopic } from "./llm.service";
import type { ProcessedEvent } from "../types/events";
import { logger } from "../utils/logger";

const RELABEL_MESSAGE_COUNT = 10;
const TOPIC_CANDIDATE_LIMIT = 50;

export async function assignTopic(message: ProcessedEvent): Promise<string | null> {
  const existingTopics = await topicRepo.listTopics(
    message.tenantId,
    message.source,
    TOPIC_CANDIDATE_LIMIT
  );

  logger.info("AI: classifying topic", {
    messageId: message.id,
    source: message.source,
    existingTopicCount: existingTopics.length,
  });

  const classification = await classifyTopic(message.redactedText, existingTopics);

  if (classification.action === "assign" && classification.topicId) {
    logger.info("AI: assigned to existing topic", {
      messageId: message.id,
      topicId: classification.topicId,
      confidence: classification.confidence,
    });
    await topicRepo.assignMessageToTopic(
      message.id,
      message.source,
      classification.topicId,
      classification.confidence
    );
    await maybeRelabelTopic(classification.topicId, message.source);
    return classification.topicId;
  }

  logger.info("AI: creating new topic", {
    messageId: message.id,
    source: message.source,
    confidence: classification.confidence,
  });

  const summary = classification.newTopic ?? (await summarizeTopic([message.redactedText]));
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

  logger.info("AI: topic created", {
    messageId: message.id,
    topicId: topic.id,
    label: topic.label,
  });

  return topic.id;
}

async function maybeRelabelTopic(
  topicId: string,
  source: ProcessedEvent["source"]
): Promise<void> {
  const topic = await topicRepo.getTopicById(topicId);
  if (!topic || topic.messageCount % RELABEL_MESSAGE_COUNT !== 0) return;

  const messages = await messageRepo.findMessagesByTopic(
    topicId,
    source,
    RELABEL_MESSAGE_COUNT
  );
  const texts = messages.map((m) => m.redactedText);
  if (!texts.length) return;

  const summary = await summarizeTopic(texts);
  await topicRepo.updateTopicSummary(topicId, summary.label, summary.summary, summary.keywords);
  logger.debug("Relabeled topic", { topicId, source, label: summary.label });
}
