import { describe, expect, it } from "vitest";
import { extractImageMessages } from "@/lib/whatsapp/parse";
import { normalize } from "@/lib/whatsapp/whitelist";

describe("extractImageMessages", () => {
  it("extracts image-type messages from a WhatsApp payload", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "34600111222", type: "image", image: { id: "MEDIA1" }, timestamp: "123" },
                  { from: "34600111222", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = extractImageMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ from: "34600111222", mediaId: "MEDIA1" });
  });

  it("empty or unexpected payload → empty list", () => {
    expect(extractImageMessages({})).toEqual([]);
    expect(extractImageMessages(null)).toEqual([]);
  });
});

describe("normalize number", () => {
  it("keeps digits only", () => {
    expect(normalize("+34 600-111-222")).toBe("34600111222");
  });
});
