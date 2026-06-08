import { config } from "../config";

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { name: "phone", pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  { name: "credit_card", pattern: /\b(?:\d[ -]*?){13,16}\b/g, replacement: "[CARD]" },
  { name: "api_key", pattern: /\b(?:sk|pk|xoxb|xoxp)-[A-Za-z0-9_-]{10,}\b/g, replacement: "[SECRET]" },
];

export function redactText(text: string): string {
  if (!config.REDACT_PII) return text;

  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
