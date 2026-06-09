/**
 * Parsing helpers for WhatsApp Cloud API payloads. Kept out of the route file so
 * the route only exports HTTP handlers (Next.js requirement).
 */

export interface ImageMessage {
  from: string;
  mediaId: string;
  timestamp: string;
}

/** Extracts image messages from a WhatsApp Cloud API payload. */
export function extractImageMessages(payload: unknown): ImageMessage[] {
  const out: ImageMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[] } })?.value;
      for (const message of value?.messages ?? []) {
        const msg = message as {
          from?: string;
          timestamp?: string;
          type?: string;
          image?: { id?: string };
        };
        if (msg.type === "image" && msg.from && msg.image?.id) {
          out.push({ from: msg.from, mediaId: msg.image.id, timestamp: msg.timestamp ?? "" });
        }
      }
    }
  }
  return out;
}
