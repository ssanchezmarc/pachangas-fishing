/**
 * Issue 10 — Inngest client (the async queue). The WhatsApp webhook replies 200
 * immediately and emits an event; the LLM reading + validation run here, never in
 * the webhook handler (PRD §10: avoid timeouts).
 *
 * In production set INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY; locally the Inngest
 * dev server works keyless.
 */
import { Inngest } from "inngest";

/** Payload of the event the webhook emits per whitelisted inbound photo. */
export interface WhatsappScorecardReceived {
  /** Sender's phone number (already whitelisted). */
  from: string;
  /** WhatsApp media id of the photo. */
  mediaId: string;
  /** Send timestamp reported by WhatsApp (RNF-3: send time, not receive). */
  receivedAt: string;
}

export const inngest = new Inngest({ id: "pachangas-fishing" });
