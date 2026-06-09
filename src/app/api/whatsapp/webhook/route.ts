/**
 * Slice 10 — WhatsApp Cloud API webhook (skeleton).
 *
 * Critical architecture decision (PRD §10): reply 200 immediately and ENQUEUE the
 * processing; NEVER call the LLM inside the handler (avoids timeouts).
 *
 * Pending HITL (see todo-list):
 *  - Meta Business onboarding/verification + dedicated number → WHATSAPP_VERIFY_TOKEN.
 *  - Queue choice (Inngest / QStash) → wiring of `enqueueProcessing`.
 *
 * What IS solved here: the verification handshake (GET), the fast 200 reply
 * (POST) and the number whitelist filtering.
 */
import { NextResponse } from "next/server";
import { isWhitelisted } from "@/lib/whatsapp/whitelist";
import { extractImageMessages } from "@/lib/whatsapp/parse";

/** Webhook verification by Meta (initial handshake). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * Message reception. ALWAYS replies 200 immediately; the real work (AI reading +
 * validation) is delegated to a queue.
 */
export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // 200 anyway: no Meta retries.
  }

  const messages = extractImageMessages(payload);
  for (const msg of messages) {
    if (!isWhitelisted(msg.from)) {
      // Unauthorized number: silently ignored (not processed).
      continue;
    }
    // TODO(HITL slice 10): enqueue (Inngest/QStash) the image processing:
    //   await enqueueProcessing({ from: msg.from, mediaId: msg.mediaId, receivedAt })
    // The job will download the image, call resolveReader().read(), validate
    // (validateScorecard) and create the scorecard in auto/flagged status.
  }

  // Reply 200 fast (PRD §7.3): never process the LLM here.
  return NextResponse.json({ ok: true });
}
