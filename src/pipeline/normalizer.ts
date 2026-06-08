import type { RawEvent } from "../types/events";

export function normalizeEvent(event: RawEvent): RawEvent {
  return {
    ...event,
    text: event.text.replace(/\s+/g, " ").trim(),
    participants: [...new Set(event.participants.map((p) => p.trim()).filter(Boolean))],
    threadId: event.threadId?.trim() || null,
  };
}
