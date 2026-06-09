/**
 * Issue 10 — Async processing of an inbound WhatsApp scorecard photo.
 *
 * Triggered by the `whatsapp/scorecard.received` event the webhook emits. Runs the
 * LLM reading and validation OUT of the webhook (PRD §10). Each retriable unit is a
 * step: a transient WhatsApp/LLM failure retries that step without re-running the
 * rest.
 */
import { inngest, type WhatsappScorecardReceived } from "./client";
import { resolveReader } from "@/lib/ai/reader";
import { downloadMedia, sendText } from "@/lib/whatsapp/api";
import { ingestReading } from "@/lib/whatsapp/ingest";
import { controllerMessage } from "@/lib/whatsapp/quality-loop";

export const processInboundScorecard = inngest.createFunction(
  {
    id: "process-inbound-scorecard",
    name: "Process inbound WhatsApp scorecard",
    triggers: [{ event: "whatsapp/scorecard.received" }],
  },
  async ({ event, step }) => {
    const { from, mediaId } = event.data as WhatsappScorecardReceived;

    // 1) Download the photo and read it with the (mock/real) vision model.
    const reading = await step.run("read-photo", async () => {
      const media = await downloadMedia(mediaId);
      return resolveReader().read({ image: media.bytes, mimeType: media.mimeType });
    });

    // 2) Match the lot to the active round's roster, validate and store the plica.
    const outcome = await step.run("ingest", () => ingestReading(reading));

    // 3) Quality loop (issue 11): if the read failed validation / low confidence or
    // the lot isn't in the roster, ask the controller to resend or confirm. A
    // resend re-enters this same function and updates the plica; if it keeps
    // failing it stays `flagged`, i.e. in the committee HITL queue (issue 09).
    const message = controllerMessage(outcome);
    if (message) {
      await step.run("notify-controller", () => sendText(from, message));
    }

    return outcome;
  },
);

export const functions = [processInboundScorecard];
