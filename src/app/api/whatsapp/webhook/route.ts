/**
 * Issue 10 — WhatsApp Cloud API webhook.
 *
 * Critical architecture decision (PRD §10): reply 200 immediately and ENQUEUE the
 * processing (Inngest); NEVER call the LLM inside the handler (avoids timeouts).
 *
 * Solved here: the verification handshake (GET), optional payload signature
 * verification (X-Hub-Signature-256), the number whitelist filter, and emitting
 * one `whatsapp/scorecard.received` event per allowed image. The LLM reading +
 * validation + plica creation happen in the Inngest function.
 *
 * Pending (your trámite): Meta Business onboarding + dedicated number, and the
 * secrets (WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET / WHATSAPP_ACCESS_TOKEN /
 * WHATSAPP_PHONE_NUMBER_ID).
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { isWhitelisted } from "@/lib/whatsapp/whitelist";
import { extractImageMessages } from "@/lib/whatsapp/parse";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

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

/** Verifies Meta's HMAC-SHA256 payload signature. Skipped when no app secret is set. */
function signatureValid(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not configured (local/CI): don't block.
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Message reception. ALWAYS replies 200 immediately; the real work (AI reading +
 * validation) is delegated to the Inngest queue.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!signatureValid(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true }); // 200 anyway: no Meta retries.
  }

  for (const msg of extractImageMessages(payload)) {
    if (!isWhitelisted(msg.from)) continue; // unauthorized number: ignored (RF-3).
    await inngest.send({
      name: "whatsapp/scorecard.received",
      data: { from: msg.from, mediaId: msg.mediaId, receivedAt: msg.timestamp },
    });
  }

  // Reply 200 fast (PRD §7.3): never process the LLM here.
  return NextResponse.json({ ok: true });
}
