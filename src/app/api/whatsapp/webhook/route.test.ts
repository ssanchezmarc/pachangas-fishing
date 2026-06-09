import { describe, it, expect, beforeEach, vi } from "vitest";

// The webhook must NOT process inline; it enqueues. Mock the Inngest client so we
// can assert what gets enqueued (LLM mocked, issue 10 acceptance).
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));

import { GET, POST } from "./route";
import { inngest } from "@/lib/inngest/client";

const send = inngest.send as unknown as ReturnType<typeof vi.fn>;

function post(payload: unknown): Request {
  return new Request("http://localhost/api/whatsapp/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

const WHITELISTED = "34600111222";
const OUTSIDER = "34699999999";

beforeEach(() => {
  send.mockClear();
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-tok";
  process.env.WHATSAPP_WHITELIST = WHITELISTED;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe("WhatsApp webhook — verification handshake (GET)", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-tok&hub.challenge=42",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("rejects a wrong verify token", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42",
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("WhatsApp webhook — message reception (POST)", () => {
  const imageFrom = (from: string, mediaId: string, ts = "1700000000") => ({
    from,
    timestamp: ts,
    type: "image",
    image: { id: mediaId },
  });
  const wrap = (messages: unknown[]) => ({
    entry: [{ changes: [{ value: { messages } }] }],
  });

  it("replies 200 and enqueues one job per whitelisted image", async () => {
    const res = await POST(post(wrap([imageFrom(WHITELISTED, "MEDIA1", "1700000005")])));
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      name: "whatsapp/scorecard.received",
      data: { from: WHITELISTED, mediaId: "MEDIA1", receivedAt: "1700000005" },
    });
  });

  it("ignores images from numbers outside the whitelist (RF-3)", async () => {
    const res = await POST(post(wrap([imageFrom(OUTSIDER, "MEDIA2")])));
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores non-image messages", async () => {
    const res = await POST(
      post(wrap([{ from: WHITELISTED, timestamp: "1", type: "text", text: { body: "hola" } }])),
    );
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it("still replies 200 on a non-JSON body (no Meta retries)", async () => {
    const res = await POST(
      new Request("http://localhost/api/whatsapp/webhook", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });
});
