import { describe, expect, it } from "vitest";
import { ALTO_CARRION_PRESET } from "./types";
import {
  signalsConsistent,
  validateScorecard,
  type ScorecardReading,
  type ValidationOptions,
} from "./validation";

const options: ValidationOptions = {
  config: ALTO_CARRION_PRESET,
  rosterLots: new Set(["17", "18", "42"]),
  confidenceThreshold: 0.9,
};

function baseReading(): ScorecardReading {
  // 2 legal (20, 23) + 1 undersized (18) → legal 2, undersized 1, biggest 23
  return {
    lot: "17",
    catches: [
      { tens: 2, units: 0, handwrittenSize: 20 },
      { tens: 2, units: 3, handwrittenSize: 23 },
      { tens: 1, units: 8, handwrittenSize: 18 },
    ],
    totals: { legalCatches: 2, undersizedCatches: 1, biggestCatchCm: 23 },
    confidence: { lot: 0.99, catches: 0.95, totals: 0.97 },
  };
}

describe("signalsConsistent", () => {
  it("marks agree with the handwritten size", () => {
    expect(signalsConsistent({ tens: 2, units: 0, handwrittenSize: 20 })).toBe(true);
    expect(signalsConsistent({ tens: 1, units: 9, handwrittenSize: 19.3 })).toBe(true);
  });
  it("detects a discrepancy", () => {
    expect(signalsConsistent({ tens: 2, units: 1, handwrittenSize: 20 })).toBe(false);
  });
});

describe("validateScorecard", () => {
  const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

  it("perfect scorecard → auto", () => {
    const r = validateScorecard(baseReading(), options);
    expect(r.status).toBe("auto");
    expect(r.checksumOk).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("legal-catch total does not match → flagged", () => {
    const l = baseReading();
    l.totals.legalCatches = 3; // I read 2
    const r = validateScorecard(l, options);
    expect(r.status).toBe("flagged");
    expect(r.checksumOk).toBe(false);
    expect(codes(r)).toContain("legalCatchesMismatch");
    expect(r.issues.find((i) => i.code === "legalCatchesMismatch")?.params).toMatchObject({
      read: 2,
      total: 3,
    });
  });

  it("inconsistent signals → flagged", () => {
    const l = baseReading();
    l.catches[0] = { tens: 2, units: 1, handwrittenSize: 20 };
    const r = validateScorecard(l, options);
    expect(r.status).toBe("flagged");
    expect(codes(r)).toContain("signalsMismatch");
  });

  it("lot not in roster → flagged", () => {
    const l = baseReading();
    l.lot = "99";
    const r = validateScorecard(l, options);
    expect(r.status).toBe("flagged");
    expect(codes(r)).toContain("lotNotInRoster");
  });

  it("biggest catch does not match → flagged", () => {
    const l = baseReading();
    l.totals.biggestCatchCm = 25;
    const r = validateScorecard(l, options);
    expect(codes(r)).toContain("biggestCatchMismatch");
  });

  it("checksum OK but low confidence → flagged (checksumOk stays true)", () => {
    const l = baseReading();
    l.confidence.lot = 0.5;
    const r = validateScorecard(l, options);
    expect(r.status).toBe("flagged");
    expect(r.checksumOk).toBe(true);
    expect(codes(r)).toContain("lowLotConfidence");
  });
});
