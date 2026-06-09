/**
 * Issue 13 — Push a summary + link to the club's WhatsApp group when a round's
 * standings are published (provisional and again final). The live web stays the
 * source of truth (RF-10); the push is just a notification.
 *
 * Note: WhatsApp Cloud API messages 1:1, not groups, so the destination is a
 * configured recipient (WHATSAPP_GROUP_RECIPIENT) — in practice the group's relay
 * number or the organizer. No-ops (logs) when unset, so it's testable without Meta.
 *
 * Pure pieces (transition gate, message text) are exported for testing.
 */
import { sendText } from "./api";

export type PublishStatus = "provisional" | "final";

/** A round transition that publishes standings (the two push triggers). */
export function isPublishTransition(to: string): to is PublishStatus {
  return to === "provisional" || to === "final";
}

/** The group message for a published round (Spanish — the club's audience). */
export function standingsPushMessage(
  status: PublishStatus,
  roundName: string,
  url: string,
): string {
  const head =
    status === "final" ? "🏁 Clasificación FINAL" : "📊 Clasificación provisional";
  return `${head} de "${roundName}".\nVer en vivo: ${url}`;
}

function roundUrl(roundId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/round/${roundId}`;
}

/** Sends the published-standings summary to the configured group recipient. */
export async function pushStandingsSummary(
  roundId: string,
  roundName: string,
  status: PublishStatus,
): Promise<void> {
  const recipient = process.env.WHATSAPP_GROUP_RECIPIENT;
  if (!recipient) {
    console.log(`[whatsapp:summary] WHATSAPP_GROUP_RECIPIENT unset; skipping push for ${roundId}`);
    return;
  }
  await sendText(recipient, standingsPushMessage(status, roundName, roundUrl(roundId)));
}
