import { config } from "../config";
import type { ExtractedIssue } from "../types/issues";
import type { Issue } from "../types/issues";
import type { Topic } from "../types/topics";
import type { RecommendationType } from "../types/recommendations";
import { logger } from "../utils/logger";

interface TopicSummary {
  label: string;
  summary: string;
  keywords: string[];
}

export interface TopicClassification {
  action: "assign" | "create";
  topicId: string | null;
  confidence: number;
  newTopic?: TopicSummary;
}

export interface IssueExtractionResult {
  issue: ExtractedIssue | null;
}

export interface IssueMatchResult {
  matchedIssueId: string | null;
  confidence: number;
}

export interface AiRecommendation {
  type: RecommendationType;
  title: string;
  body: string;
  priority: number;
  issueId?: string;
  topicId?: string;
  evidenceMessageIds?: string[];
}

interface RecommendationContext {
  userId: string;
  openIssues: Issue[];
  staleIssues: Issue[];
  recentMentions: Array<{ id: string; text: string; source: string }>;
  topics: Topic[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
}

function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastGeminiFinishedAt = 0;
let geminiSerial: Promise<unknown> = Promise.resolve();

/** Serialize Gemini calls and enforce GEMINI_MIN_DELAY_MS between completed requests. */
function runSerialGemini<T>(fn: () => Promise<T>): Promise<T> {
  const next = geminiSerial.then(async () => {
    const waitMs = config.GEMINI_MIN_DELAY_MS - (Date.now() - lastGeminiFinishedAt);
    if (waitMs > 0) {
      logger.info("AI: throttling Gemini request", {
        waitMs,
        minDelayMs: config.GEMINI_MIN_DELAY_MS,
      });
      await sleep(waitMs);
    }
    try {
      return await fn();
    } finally {
      lastGeminiFinishedAt = Date.now();
    }
  });
  geminiSerial = next.catch(() => {});
  return next;
}

export function logGeminiRateLimitConfig(): void {
  const maxRpm = Math.floor(60_000 / config.GEMINI_MIN_DELAY_MS);
  const sourcesPerPoll = 3;
  const maxAiCallsPerPoll = config.AI_REPROCESS_PER_POLL * sourcesPerPoll;
  const pollsPerDay = (24 * 60) / config.POLL_INTERVAL_MINUTES;
  const projectedDailyAiCalls = Math.round(maxAiCallsPerPoll * pollsPerDay);

  logger.info("Gemini rate limits (from env)", {
    model: config.GOOGLE_AI_MODEL,
    minDelayMs: config.GEMINI_MIN_DELAY_MS,
    maxRequestsPerMinute: maxRpm,
    reprocessPerSourcePerPoll: config.AI_REPROCESS_PER_POLL,
    maxAiCallsPerPoll,
    pollIntervalMinutes: config.POLL_INTERVAL_MINUTES,
    projectedDailyAiCalls,
  });

  if (projectedDailyAiCalls > 1000) {
    logger.warn("Projected daily AI calls exceed gemini-2.5-flash-lite free tier (~1000/day)", {
      projectedDailyAiCalls,
      hint: "Lower AI_REPROCESS_PER_POLL or increase POLL_INTERVAL_MINUTES",
    });
  }
}

interface GeminiQuotaInfo {
  retryMs: number | null;
  quotaIds: string[];
  modelHasNoFreeTier: boolean;
  summary: string;
}

function parseGeminiError(body: string): GeminiQuotaInfo {
  const fallback: GeminiQuotaInfo = {
    retryMs: null,
    quotaIds: [],
    modelHasNoFreeTier: false,
    summary: body,
  };

  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        details?: Array<{
          "@type"?: string;
          retryDelay?: string;
          violations?: Array<{ quotaId?: string }>;
        }>;
      };
    };

    const message = parsed.error?.message ?? body;
    const details = parsed.error?.details ?? [];
    const retryInfo = details.find((d) => d["@type"]?.includes("RetryInfo"));
    const quotaFailure = details.find((d) => d["@type"]?.includes("QuotaFailure"));

    let retryMs: number | null = null;
    if (retryInfo?.retryDelay) {
      const seconds = parseInt(retryInfo.retryDelay.replace(/\D/g, ""), 10);
      retryMs = Number.isFinite(seconds) ? seconds * 1000 : null;
    }

    const quotaIds =
      quotaFailure?.violations?.map((v) => v.quotaId).filter(Boolean) as string[] ?? [];
    const modelHasNoFreeTier = /limit:\s*0/i.test(message);

    let summary = message.split("\n")[0] ?? message;
    if (modelHasNoFreeTier) {
      summary =
        "This model has no free-tier quota (limit: 0). Gemini 2.0 models were shut down — set GOOGLE_AI_MODEL=gemini-2.5-flash-lite or gemini-3.1-flash-lite.";
    } else if (quotaIds.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier")) {
      summary = "Daily free-tier quota exhausted for this model — wait until reset or enable billing.";
    } else if (quotaIds.includes("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")) {
      summary = "Per-minute rate limit hit — retry shortly or lower request frequency.";
    }

    return { retryMs, quotaIds, modelHasNoFreeTier, summary };
  } catch {
    return fallback;
  }
}

async function callGemini(
  model: string,
  system: string,
  user: string
): Promise<GeminiResponse & { _errorBody?: string; _status?: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GOOGLE_AI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { _errorBody: body, _status: response.status };
  }

  return (await response.json()) as GeminiResponse;
}

async function chatJson<T>(system: string, user: string, task: string): Promise<T> {
  if (!config.GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY is required for AI reasoning tasks");
  }

  return runSerialGemini(async () => {
    const model = config.GOOGLE_AI_MODEL;
    const started = Date.now();

    for (let attempt = 1; attempt <= config.GEMINI_MAX_RETRIES; attempt++) {
      logger.info("AI: Gemini request", { task, model, attempt });

      const data = await callGemini(model, system, user);

      if (data._status) {
        const body = data._errorBody ?? "";
        const quota = parseGeminiError(body);

        if (data._status === 429 && attempt < config.GEMINI_MAX_RETRIES && !quota.modelHasNoFreeTier) {
          const retryMs = quota.retryMs ?? 45000;
          logger.warn("AI: Gemini quota/rate limit, retrying", {
            task,
            attempt,
            retryMs,
            quotaIds: quota.quotaIds,
            reason: quota.summary,
          });
          await sleep(retryMs);
          continue;
        }

        throw new Error(`Google AI ${data._status} (${task}): ${quota.summary}`);
      }

      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error(`Google AI returned empty response (${task})`);
      }

      try {
        const result = parseJsonResponse<T>(content);
        logger.info("AI: Gemini response ok", {
          task,
          attempt,
          durationMs: Date.now() - started,
        });
        return result;
      } catch (err) {
        logger.warn("AI: failed to parse Gemini JSON", {
          task,
          content: content.slice(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    throw new Error(`Google AI failed after retries (${task})`);
  });
}

export interface MessageAnalysis {
  topic: TopicClassification;
  issue: ExtractedIssue | null;
}

export async function analyzeMessage(
  messageText: string,
  messageId: string,
  existingTopics: Topic[],
  contextMessages: string[]
): Promise<MessageAnalysis> {
  const topicList = existingTopics.map((t) => ({
    id: t.id,
    label: t.label,
    summary: t.summary,
    keywords: t.keywords,
  }));

  const result = await chatJson<MessageAnalysis>(
    `Analyze a message for topic classification and open issues in ONE response.
Return JSON: {
  topic: { action: "assign"|"create", topicId: string|null, confidence: number, newTopic?: { label, summary, keywords[] } },
  issue: { title, status, ownerGuess, blockers[], evidenceMessageIds[], confidence } | null
}.
- topic.action "assign" uses an existing topicId; "create" must include newTopic.
- issue is null for casual/non-actionable content.
- evidenceMessageIds must include "${messageId}" when issue is found.`,
    JSON.stringify({
      message: messageText,
      messageId,
      context: contextMessages,
      existingTopics: topicList,
    }),
    "analyzeMessage"
  );

  if (result.issue) {
    result.issue = {
      ...result.issue,
      evidenceMessageIds: result.issue.evidenceMessageIds?.length
        ? result.issue.evidenceMessageIds
        : [messageId],
    };
  }

  if (result.topic.action === "create" && !result.topic.newTopic) {
    result.topic.newTopic = {
      label: messageText.slice(0, 80) || "Untitled topic",
      summary: messageText.slice(0, 300),
      keywords: [],
    };
  }

  return result;
}

export async function classifyTopic(
  messageText: string,
  existingTopics: Topic[]
): Promise<TopicClassification> {
  const topicList = existingTopics.map((t) => ({
    id: t.id,
    label: t.label,
    summary: t.summary,
    keywords: t.keywords,
  }));

  const result = await chatJson<TopicClassification>(
    `You classify messages into conversation topics.
Return JSON: { action: "assign"|"create", topicId: string|null, confidence: number, newTopic?: { label, summary, keywords[] } }.
- Use action "assign" with an existing topicId when the message clearly belongs to that topic.
- Use action "create" with newTopic when no existing topic fits.
- confidence is 0-1.`,
    JSON.stringify({ message: messageText, existingTopics: topicList }),
    "classifyTopic"
  );

  if (result.action === "assign" && result.topicId) {
    const exists = existingTopics.some((t) => t.id === result.topicId);
    if (!exists) {
      return {
        action: "create",
        topicId: null,
        confidence: result.confidence,
        newTopic: result.newTopic ?? (await summarizeTopic([messageText])),
      };
    }
  }

  if (result.action === "create" && !result.newTopic) {
    result.newTopic = await summarizeTopic([messageText]);
  }

  return result;
}

export async function summarizeTopic(messages: string[]): Promise<TopicSummary> {
  const sample = messages.slice(0, 10).join("\n---\n");
  return chatJson<TopicSummary>(
    "Summarize conversation topics from the provided messages. Return JSON: { label, summary, keywords[] }. Use only provided text.",
    sample,
    "summarizeTopic"
  );
}

export async function extractIssue(
  messageText: string,
  contextMessages: string[],
  messageId: string
): Promise<ExtractedIssue | null> {
  const result = await chatJson<IssueExtractionResult>(
    `Analyze conversation for actionable open issues.
Return JSON: { issue: { title, status: "open"|"in_progress"|"resolved", ownerGuess, blockers[], evidenceMessageIds[], confidence } | null }.
- Return issue null if the message is casual chatter with no actionable issue.
- evidenceMessageIds must include "${messageId}" when an issue is found.
- confidence is 0-1.`,
    JSON.stringify({ message: messageText, context: contextMessages, messageId }),
    "extractIssue"
  );

  if (!result.issue) return null;

  return {
    ...result.issue,
    evidenceMessageIds: result.issue.evidenceMessageIds?.length
      ? result.issue.evidenceMessageIds
      : [messageId],
  };
}

export async function matchExistingIssue(
  extracted: ExtractedIssue,
  openIssues: Issue[]
): Promise<IssueMatchResult> {
  if (!openIssues.length) {
    return { matchedIssueId: null, confidence: 0 };
  }

  const result = await chatJson<IssueMatchResult>(
    `Determine if the extracted issue matches an existing open issue.
Return JSON: { matchedIssueId: string|null, confidence: number }.
- matchedIssueId must be one of the provided issue ids, or null if this is a new issue.
- confidence is 0-1.`,
    JSON.stringify({
      extracted: { title: extracted.title, blockers: extracted.blockers, status: extracted.status },
      openIssues: openIssues.map((i) => ({
        id: i.id,
        title: i.title,
        summary: i.summary,
        blockers: i.blockers,
        status: i.status,
      })),
    }),
    "matchExistingIssue"
  );

  if (result.matchedIssueId) {
    const exists = openIssues.some((i) => i.id === result.matchedIssueId);
    if (!exists) return { matchedIssueId: null, confidence: 0 };
  }

  logger.info("AI: issue match result", {
    matchedIssueId: result.matchedIssueId,
    confidence: result.confidence,
  });

  return result;
}

export async function generateRecommendationsWithAI(
  context: RecommendationContext
): Promise<AiRecommendation[]> {
  const result = await chatJson<{ recommendations: AiRecommendation[] }>(
    `Generate actionable recommendations for a user based on their issues and conversations.
Return JSON: { recommendations: [{ type: "follow_up"|"risk"|"synthesis"|"cleanup", title, body, priority, issueId?, topicId?, evidenceMessageIds?[] }] }.
- priority is 0-100 (higher = more urgent).
- Only reference provided issue/topic/message ids.
- Return at most 10 recommendations.`,
    JSON.stringify(context),
    "generateRecommendations"
  );

  logger.info("AI: recommendations generated", {
    count: result.recommendations?.length ?? 0,
  });

  return result.recommendations ?? [];
}
