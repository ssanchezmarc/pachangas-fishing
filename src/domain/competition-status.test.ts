import { describe, expect, it } from "vitest";
import {
  COMPETITION_STATUSES,
  PUBLIC_COMPETITION_STATUSES,
  isPubliclyVisible,
  canTransitionCompetition,
} from "./competition-status";
import type { CompetitionStatus } from "@/lib/supabase/types";

describe("competition lifecycle (issue 28)", () => {
  it("hides draft and closed from the public, shows the rest", () => {
    expect(isPubliclyVisible("draft")).toBe(false);
    expect(isPubliclyVisible("closed")).toBe(false);
    for (const s of ["open", "in_progress", "provisional", "final"] as CompetitionStatus[]) {
      expect(isPubliclyVisible(s)).toBe(true);
    }
  });

  it("public statuses are exactly the four visible ones", () => {
    expect([...PUBLIC_COMPETITION_STATUSES].sort()).toEqual(
      ["final", "in_progress", "open", "provisional"].sort(),
    );
  });

  it("allows transitions between any two states (free for now)", () => {
    for (const from of COMPETITION_STATUSES) {
      for (const to of COMPETITION_STATUSES) {
        expect(canTransitionCompetition(from, to)).toBe(true);
      }
    }
    // Including going back from closed.
    expect(canTransitionCompetition("closed", "open")).toBe(true);
  });
});
