import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/fern"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  POLL_INTERVAL_MINUTES: z.coerce.number().default(5),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_CHANNELS: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_USER_EMAIL: z.string().optional(),
  GMAIL_POLL_BACKFILL_LIMIT: z.coerce.number().default(20),
  TRANSCRIPT_DIR: z.string().default("./data/transcripts"),
  GOOGLE_AI_API_KEY: z.string().optional(),
  GOOGLE_AI_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_MIN_DELAY_MS: z.coerce.number().default(5000),
  GEMINI_MAX_RETRIES: z.coerce.number().default(3),
  AI_REPROCESS_PER_POLL: z.coerce.number().default(2),
  AI_REPROCESS_ON_STARTUP: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  ENABLE_BACKGROUND_JOBS: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  REDACT_PII: z
    .string()
    .transform((v) => v === "true")
    .default("true"),
  EXCLUDE_DM_CHANNELS: z
    .string()
    .transform((v) => v === "true")
    .default("true"),
});

export const config = envSchema.parse(process.env);

export function getSlackChannels(): string[] {
  return (config.SLACK_CHANNELS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}
