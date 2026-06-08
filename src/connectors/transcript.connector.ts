import fs from "fs/promises";
import path from "path";
import { config } from "../config";
import type { Connector } from "./base";
import type { ConnectorResult, PollCursor, RawEvent } from "../types/events";
import { logger } from "../utils/logger";

interface TranscriptCursor {
  processedFiles: string[];
}

export class TranscriptConnector implements Connector {
  source = "transcript" as const;

  async poll(pollCursor: PollCursor): Promise<ConnectorResult> {
    const cursor = (pollCursor.cursor as unknown as TranscriptCursor) ?? { processedFiles: [] };
    const processed = new Set(cursor.processedFiles);
    const events: RawEvent[] = [];

    try {
      const dir = config.TRANSCRIPT_DIR;
      await fs.mkdir(dir, { recursive: true });
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".txt") && !file.endsWith(".md")) continue;
        if (processed.has(file)) continue;

        const content = await fs.readFile(path.join(dir, file), "utf-8");
        const chunks = chunkTranscript(content, 800);

        chunks.forEach((chunk, index) => {
          events.push({
            externalId: `transcript:${file}:${index}`,
            tenantId: pollCursor.tenantId,
            source: "transcript",
            occurredAt: new Date(),
            participants: extractSpeakers(chunk),
            threadId: `transcript:${file}`,
            text: chunk,
            metadata: { file, chunkIndex: index },
          });
        });

        processed.add(file);
      }
    } catch (err) {
      logger.error("Transcript poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      events,
      nextCursor: { processedFiles: Array.from(processed) },
    };
  }
}

function chunkTranscript(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + para).length > maxChars && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

function extractSpeakers(text: string): string[] {
  const matches = text.match(/^([A-Za-z][\w\s.-]{0,30}):/gm) ?? [];
  return [...new Set(matches.map((m) => m.replace(":", "").trim()))];
}
