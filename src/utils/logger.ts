import winston from "winston";
import { config } from "../config";

const MAX_VALUE_LEN = 160;

function shorten(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Error) return value.message;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_VALUE_LEN) return oneLine;
  return `${oneLine.slice(0, MAX_VALUE_LEN)}…`;
}

function parseApiError(raw: string): string {
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return shorten(raw);

  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as {
      error?: { message?: string; code?: number; status?: string };
    };
    const msg = parsed.error?.message;
    if (msg) {
      const code = parsed.error?.code ?? parsed.error?.status;
      return code ? `[${code}] ${shorten(msg)}` : shorten(msg);
    }
  } catch {
    // fall through
  }

  return shorten(raw);
}

function formatMeta(meta: Record<string, unknown>): string {
  if (!Object.keys(meta).length) return "";

  const lines = Object.entries(meta).map(([key, value]) => {
    if (key === "error" && typeof value === "string") {
      return `  ${key}: ${parseApiError(value)}`;
    }
    return `  ${key}: ${shorten(value)}`;
  });

  return `\n${lines.join("\n")}`;
}

const devFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const tag = level.replace(/\u001b\[[0-9;]*m/g, "").toUpperCase().padEnd(5);
  return `${timestamp} ${tag} ${message}${formatMeta(meta)}`;
});

export const logger = winston.createLogger({
  level: "info",
  format:
    config.NODE_ENV === "production"
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      : winston.format.combine(
          winston.format.colorize({ all: false }),
          winston.format.timestamp({ format: "HH:mm:ss" }),
          devFormat
        ),
  transports: [new winston.transports.Console()],
});
