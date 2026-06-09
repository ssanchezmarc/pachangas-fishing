import { describe, it, expect } from "vitest";
import { isPublishTransition, standingsPushMessage } from "./summary";

describe("isPublishTransition (issue 13 triggers)", () => {
  it("fires on the provisional and final transitions only", () => {
    expect(isPublishTransition("provisional")).toBe(true);
    expect(isPublishTransition("final")).toBe(true);
    expect(isPublishTransition("open")).toBe(false);
    expect(isPublishTransition("appeals")).toBe(false);
  });
});

describe("standingsPushMessage", () => {
  it("links to the live round standings for the provisional push", () => {
    const msg = standingsPushMessage("provisional", "Manga 7", "https://x.test/round/r1");
    expect(msg).toContain("provisional");
    expect(msg).toContain("Manga 7");
    expect(msg).toContain("https://x.test/round/r1");
  });

  it("marks the final push distinctly and keeps the link", () => {
    const msg = standingsPushMessage("final", "Manga 7", "https://x.test/round/r1");
    expect(msg).toMatch(/FINAL/);
    expect(msg).toContain("https://x.test/round/r1");
  });
});
