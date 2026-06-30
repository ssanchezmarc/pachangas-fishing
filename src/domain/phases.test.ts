import { describe, expect, it } from "vitest";
import { phaseLabel, phaseIndex } from "./phases";

describe("phaseLabel", () => {
  it("maps the 1-based phase index to a letter", () => {
    expect(phaseLabel(1)).toBe("A");
    expect(phaseLabel(2)).toBe("B");
    expect(phaseLabel(26)).toBe("Z");
  });

  it("rolls over past Z (Excel-style) for an arbitrary number of phases", () => {
    expect(phaseLabel(27)).toBe("AA");
    expect(phaseLabel(28)).toBe("AB");
    expect(phaseLabel(52)).toBe("AZ");
    expect(phaseLabel(53)).toBe("BA");
  });

  it("falls back to the string form for non-positive or non-integer indices", () => {
    expect(phaseLabel(0)).toBe("0");
    expect(phaseLabel(-1)).toBe("-1");
    expect(phaseLabel(1.5)).toBe("1.5");
  });
});

describe("phaseIndex (issue 53 — inverse of phaseLabel)", () => {
  it("maps a phase letter back to its 1-based index", () => {
    expect(phaseIndex("A")).toBe(1);
    expect(phaseIndex("B")).toBe(2);
    expect(phaseIndex("Z")).toBe(26);
    expect(phaseIndex("AA")).toBe(27);
    expect(phaseIndex("BA")).toBe(53);
  });

  it("is case-insensitive and trims surrounding space", () => {
    expect(phaseIndex(" a ")).toBe(1);
    expect(phaseIndex("ab")).toBe(28);
  });

  it("round-trips with phaseLabel", () => {
    for (const n of [1, 2, 5, 26, 27, 53, 100]) {
      expect(phaseIndex(phaseLabel(n))).toBe(n);
    }
  });

  it("returns null for empty or non-letter input", () => {
    expect(phaseIndex("")).toBeNull();
    expect(phaseIndex("  ")).toBeNull();
    expect(phaseIndex("1")).toBeNull();
    expect(phaseIndex("A1")).toBeNull();
  });
});
