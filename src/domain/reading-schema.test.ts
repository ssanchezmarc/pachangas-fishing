import { describe, expect, it } from "vitest";
import { parseScorecardReading } from "./reading-schema";
import { validateScorecard } from "./validation";
import { ALTO_CARRION_PRESET } from "./types";

describe("parseScorecardReading (slice 07 contract)", () => {
  const valid = {
    lot: "17",
    catches: [{ tens: 2, units: 0, handwrittenSize: 20 }],
    totals: { legalCatches: 1, undersizedCatches: 0, biggestCatchCm: 20 },
    confidence: { lot: 0.98, catches: 0.95, totals: 0.97 },
  };

  it("accepts a conforming reading", () => {
    expect(() => parseScorecardReading(valid)).not.toThrow();
  });

  it("rejects confidence outside [0,1]", () => {
    expect(() =>
      parseScorecardReading({ ...valid, confidence: { ...valid.confidence, lot: 1.5 } }),
    ).toThrow();
  });

  it("rejects tens digits out of range", () => {
    expect(() =>
      parseScorecardReading({ ...valid, catches: [{ tens: 12, units: 0, handwrittenSize: 20 }] }),
    ).toThrow();
  });

  it("the parsed output fits the checksum validation (08)", () => {
    const reading = parseScorecardReading(valid);
    const r = validateScorecard(reading, {
      config: ALTO_CARRION_PRESET,
      rosterLots: new Set(["17"]),
    });
    expect(r.status).toBe("auto");
  });
});
