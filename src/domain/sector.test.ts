import { describe, expect, it } from "vitest";
import { sectorLabel } from "./sector";

describe("sectorLabel (issue 50 — river + venue + sector)", () => {
  it("joins the three non-empty parts", () => {
    expect(sectorLabel({ river: "Carrión", venue: "Coto A", name: "17" })).toBe("Carrión · Coto A · 17");
  });

  it("skips blank or missing river/venue", () => {
    expect(sectorLabel({ river: "", venue: "", name: "A" })).toBe("A");
    expect(sectorLabel({ name: "B" })).toBe("B");
    expect(sectorLabel({ river: "Carrión", venue: "", name: "17/18/19" })).toBe("Carrión · 17/18/19");
  });

  it("trims surrounding whitespace on each part", () => {
    expect(sectorLabel({ river: " Carrión ", venue: " ", name: " 17 " })).toBe("Carrión · 17");
  });
});
