import * as issueRepo from "../db/repositories/issue.repository";
import * as messageRepo from "../db/repositories/message.repository";
import { extractIssue, matchExistingIssue } from "./llm.service";
import type { ProcessedEvent } from "../types/events";
import type { Issue } from "../types/issues";
import { logger } from "../utils/logger";

const CREATE_CONFIDENCE_THRESHOLD = 0.55;
const MATCH_CONFIDENCE_THRESHOLD = 0.6;

export async function processIssuesForMessage(
  message: ProcessedEvent,
  topicId: string | null
): Promise<Issue | null> {
  const context = message.threadId
    ? await messageRepo.findThreadMessages(
        message.tenantId,
        message.threadId,
        message.source,
        10
      )
    : [];

  const contextTexts = context.map((m) => m.redactedText);

  logger.info("AI: extracting issue", {
    messageId: message.id,
    source: message.source,
    contextCount: contextTexts.length,
  });

  const extracted = await extractIssue(message.redactedText, contextTexts, message.id);

  if (!extracted || extracted.confidence < CREATE_CONFIDENCE_THRESHOLD) {
    logger.info("AI: no issue found", {
      messageId: message.id,
      source: message.source,
      confidence: extracted?.confidence ?? 0,
    });
    return null;
  }

  logger.info("AI: issue candidate found", {
    messageId: message.id,
    title: extracted.title,
    confidence: extracted.confidence,
  });

  const openIssues = await issueRepo.listIssues(message.tenantId, undefined, message.source);
  const activeIssues = openIssues.filter((i) =>
    ["open", "in_progress"].includes(i.status)
  );

  const match = await matchExistingIssue(extracted, activeIssues);
  const existing =
    match.matchedIssueId && match.confidence >= MATCH_CONFIDENCE_THRESHOLD
      ? activeIssues.find((i) => i.id === match.matchedIssueId) ?? null
      : null;

  if (existing) {
    const mergedEvidence = [
      ...new Set([...existing.evidenceMessageIds, ...extracted.evidenceMessageIds]),
    ];

    if (extracted.status === "resolved") {
      return issueRepo.updateIssue(existing.id, {
        status: "resolved",
        evidenceMessageIds: mergedEvidence,
        confidence: Math.max(existing.confidence, extracted.confidence),
      });
    }

    return issueRepo.updateIssue(existing.id, {
      status: extracted.status === "in_progress" ? "in_progress" : existing.status,
      ownerGuess: extracted.ownerGuess ?? existing.ownerGuess,
      blockers: [...new Set([...existing.blockers, ...extracted.blockers])],
      evidenceMessageIds: mergedEvidence,
      confidence: Math.max(existing.confidence, extracted.confidence),
    });
  }

  if (extracted.status === "resolved") return null;

  const issue = await issueRepo.createIssue(
    message.tenantId,
    message.source,
    extracted,
    topicId ?? undefined
  );
  logger.info("Created issue", { issueId: issue.id, source: message.source, title: issue.title });
  return issue;
}

export async function markStaleIssues(tenantId: string): Promise<number> {
  const stale = await issueRepo.findStaleIssues(tenantId);
  for (const issue of stale) {
    await issueRepo.updateIssue(issue.id, { status: "stale" });
  }
  return stale.length;
}
