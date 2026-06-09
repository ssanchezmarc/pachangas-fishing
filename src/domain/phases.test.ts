import { describe, expect, it } from "vitest";
import { phaseLabel } from "./phases";

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
