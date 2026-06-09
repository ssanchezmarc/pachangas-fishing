/**
 * WhatsApp Cloud API (Graph) helpers — media download and message send.
 *
 * Both no-op gracefully when the credentials are absent (local/CI without Meta
 * onboarding): downloadMedia returns an empty image (the mock reader ignores the
 * bytes) and sendText logs instead of calling Meta. This keeps the whole flow
 * runnable end-to-end before the Meta Business number is provisioned (issue 10).
 */
const GRAPH = "https://graph.facebook.com/v21.0";

function accessToken(): string | null {
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}

function phoneNumberId(): string | null {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || null;
}

export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Two-step media download (Graph API): resolve the media id to a URL, then fetch
 * the bytes with the bearer token. Returns an empty JPEG placeholder when no token
 * is configured, so the queue + mock reader still run locally.
 */
export async function downloadMedia(mediaId: string): Promise<DownloadedMedia> {
  const token = accessToken();
  if (!token) return { bytes: new Uint8Array(), mimeType: "image/jpeg" };

  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`WhatsApp media meta failed (${metaRes.status}).`);
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("WhatsApp media has no URL.");

  const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!binRes.ok) throw new Error(`WhatsApp media download failed (${binRes.status}).`);
  return {
    bytes: new Uint8Array(await binRes.arrayBuffer()),
    mimeType: meta.mime_type ?? "image/jpeg",
  };
}

/**
 * Sends a plain text message to a number. No-ops (logs) when credentials are
 * absent, so the quality-loop bot (#11) and the summary push (#13) are testable
 * without Meta.
 */
export async function sendText(to: string, body: string): Promise<void> {
  const token = accessToken();
  const phoneId = phoneNumberId();
  if (!token || !phoneId) {
    console.log(`[whatsapp:mock] → ${to}: ${body}`);
    return;
  }
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
}
