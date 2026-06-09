import { describe, expect, it } from "vitest";
import { ALTO_CARRION_PRESET, type ScoringConfig } from "./types";
import { isUndersized, catchPoints, scoreScorecard, roundSize } from "./scoring";

const C = ALTO_CARRION_PRESET;

describe("roundSize", () => {
  it("rounds up to the cm (preset)", () => {
    expect(roundSize(19.3, "up")).toBe(20);
    expect(roundSize(26.7, "up")).toBe(27);
    expect(roundSize(19.0, "up")).toBe(19);
  });
  it("supports down and none (configurable)", () => {
    expect(roundSize(19.7, "down")).toBe(19);
    expect(roundSize(19.7, "none")).toBe(19.7);
  });
});

describe("isUndersized", () => {
  it("uses the measured size, not the rounded one", () => {
    expect(isUndersized(18.9, C)).toBe(true);
    expect(isUndersized(19.0, C)).toBe(false);
    expect(isUndersized(18.7, C)).toBe(true); // would round to 19 but is illegal
  });
});

describe("catchPoints (Alto Carrión preset)", () => {
  it("valid catch: 100 + cm³/100 with round-up", () => {
    // 19.3 → 20 → 100 + 8000/100 = 180
    expect(catchPoints({ sizeCm: 19.3 }, C)).toBe(180);
    // 26.7 → 27 → 100 + 19683/100 = 296.83
    expect(catchPoints({ sizeCm: 26.7 }, C)).toBeCloseTo(296.83, 5);
    // 19.0 → 19 → 100 + 6859/100 = 168.59
    expect(catchPoints({ sizeCm: 19.0 }, C)).toBeCloseTo(168.59, 5);
  });
  it("undersized catch: 60 fixed", () => {
    expect(catchPoints({ sizeCm: 18.9 }, C)).toBe(60);
    expect(catchPoints({ sizeCm: 10 }, C)).toBe(60);
  });
});

describe("catchPoints is declarative (RF-1)", () => {
  it("changing the config changes the result without touching code", () => {
    const other: ScoringConfig = {
      minSizeCm: 25,
      validCatchBasePoints: 50,
      sizeFactor: 1 / 10,
      undersizedCatchPoints: 30,
      rounding: "down",
    };
    // 24 < 25 → undersized → 30
    expect(catchPoints({ sizeCm: 24 }, other)).toBe(30);
    // 25.9 → down → 25 → 50 + 25³/10 = 50 + 1562.5 = 1612.5
    expect(catchPoints({ sizeCm: 25.9 }, other)).toBeCloseTo(1612.5, 5);
  });
});

describe("scoreScorecard", () => {
  it("aggregates points and footer totals (checksum)", () => {
    const r = scoreScorecard([{ sizeCm: 19.3 }, { sizeCm: 26.7 }, { sizeCm: 18.0 }], C);
    expect(r.legalCatches).toBe(2);
    expect(r.undersizedCatches).toBe(1);
    expect(r.biggestCatchCm).toBe(26.7);
    expect(r.catchPoints).toBeCloseTo(180 + 296.83 + 60, 5);
  });
  it("empty scorecard", () => {
    expect(scoreScorecard([], C)).toEqual({
      catchPoints: 0,
      legalCatches: 0,
      undersizedCatches: 0,
      biggestCatchCm: 0,
    });
  });
  it("is reproducible (RNF-1): same input → same output", () => {
    const catches = [{ sizeCm: 21.4 }, { sizeCm: 30.0 }, { sizeCm: 17.5 }];
    expect(scoreScorecard(catches, C)).toEqual(scoreScorecard(catches, C));
  });
});
