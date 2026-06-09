/**
 * Whitelist of WhatsApp numbers allowed to send scorecards (RF-3).
 * v1: static list via env (`WHATSAPP_WHITELIST`, comma-separated numbers).
 * Future: derive it from the roster (controllers of the active round).
 */
export function whitelist(): Set<string> {
  const raw = process.env.WHATSAPP_WHITELIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((n) => normalize(n))
      .filter((n) => n.length > 0),
  );
}

/** Normalizes a number to digits only (strips +, spaces, dashes). */
export function normalize(number: string): string {
  return number.replace(/\D/g, "");
}

export function isWhitelisted(number: string): boolean {
  return whitelist().has(normalize(number));
}
