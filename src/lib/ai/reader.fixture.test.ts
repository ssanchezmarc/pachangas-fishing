/**
 * Issue 07 — Real vision reader against a sample plica (fixture).
 *
 * Exercises the actual Gemini reader on a real "Alto Carrión" scorecard photo
 * (fixtures/plica-lote17.jpg: lot 17, an essentially empty grid → 0 legal, 2
 * undersized, no biggest). It asserts the schema-validated reading the tuned
 * prompt produces.
 *
 * GATED: it calls the live API (costs free-tier quota, mildly non-deterministic),
 * so it runs ONLY with `RUN_AI_TESTS=1` and a `GEMINI_API_KEY` present. Plain
 * `vitest run` / CI skips it. Run it with:
 *   RUN_AI_TESTS=1 npx vitest run src/lib/ai/reader.fixture.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// vitest does not load .env.local — pull GEMINI_API_KEY in without clobbering env.
function loadEnvLocal(): void {
  try {
    const path = fileURLToPath(new URL("../../../.env.local", import.meta.url));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local */
  }
}
loadEnvLocal();

const enabled = process.env.RUN_AI_TESTS === "1" && Boolean(process.env.GEMINI_API_KEY);

describe.skipIf(!enabled)("Gemini reader on a real plica fixture (#07)", () => {
  it("reads lot 17, empty grid, 0 legal / 2 undersized", async () => {
    const { OpenAICompatibleReader } = await import("./reader");
    const reader = new OpenAICompatibleReader(
      process.env.GEMINI_API_KEY!,
      process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash",
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "Gemini",
    );

    const path = fileURLToPath(new URL("./fixtures/plica-lote17.jpg", import.meta.url));
    const image = readFileSync(path);

    const reading = await reader.read({ image, mimeType: "image/jpeg" });

    expect(reading.lot).toBe("17");
    expect(reading.totals.legalCatches).toBe(0);
    expect(reading.totals.undersizedCatches).toBe(2);
    expect(reading.totals.biggestCatchCm).toBe(0);
    expect(reading.catches).toHaveLength(0);
  }, 60_000);
});
