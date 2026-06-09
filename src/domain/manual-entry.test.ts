import { describe, expect, it } from "vitest";
import { expandMeasures, parseMeasureLines } from "./manual-entry";
import { scoreScorecard } from "./scoring";
import { ALTO_CARRION_PRESET } from "./types";

describe("manual entry — measures expansion (issue 23)", () => {
  it("expands size×quantity into individual catches", () => {
    const catches = expandMeasures(
      [
        { sizeCm: 21, quantity: 3 },
        { sizeCm: 26, quantity: 1 },
      ],
      2,
      ALTO_CARRION_PRESET,
    );
    // 3 + 1 legal + 2 undersized = 6 catches.
    expect(catches).toHaveLength(6);
    expect(catches.filter((c) => c.sizeCm === 21)).toHaveLength(3);
    expect(catches.filter((c) => c.sizeCm === 26)).toHaveLength(1);
  });

  it("rounds the legal sizes up to the cm (no decimals)", () => {
    const catches = expandMeasures([{ sizeCm: 20.2, quantity: 1 }], 0, ALTO_CARRION_PRESET);
    expect(catches[0].sizeCm).toBe(21);
  });

  it("undersized fish score as undersized (60 pts) and are not legal", () => {
    const catches = expandMeasures([{ sizeCm: 21, quantity: 1 }], 2, ALTO_CARRION_PRESET);
    const r = scoreScorecard(catches, ALTO_CARRION_PRESET);
    expect(r.legalCatches).toBe(1);
    expect(r.undersizedCatches).toBe(2);
    // one legal 21 (100 + 21³/100 = 192.61) + two undersized (60 each) = 312.61
    expect(r.catchPoints).toBeCloseTo(192.61 + 120, 2);
  });

  it("parses the textarea measure lines flexibly", () => {
    expect(parseMeasureLines("21 3\n26x1\n19:2")).toEqual([
      { sizeCm: 21, quantity: 3 },
      { sizeCm: 26, quantity: 1 },
      { sizeCm: 19, quantity: 2 },
    ]);
  });

  it("defaults quantity to 1 when omitted and ignores blank lines", () => {
    expect(parseMeasureLines("22\n\n  \n24 2")).toEqual([
      { sizeCm: 22, quantity: 1 },
      { sizeCm: 24, quantity: 2 },
    ]);
  });
});
