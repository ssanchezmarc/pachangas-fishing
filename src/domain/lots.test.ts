import { describe, expect, it } from "vitest";
import {
  lotParticipations,
  participationsByRound,
  fishRounds,
  controlRounds,
  lotsByNumber,
  type LotAssignment,
} from "./lots";

describe("lots → participations (issues 20 + 35)", () => {
  // Two lots in a 2-round phase with fish/control role inversion (issues 18/35):
  // round r1: lot 1 fishes sector A, lot 2 controls lot 1.
  // round r2: roles invert — lot 2 fishes sector B, lot 1 controls lot 2.
  const lots: LotAssignment[] = [
    {
      lotId: "lot1",
      number: 1,
      anglerId: "ana",
      rounds: [
        { roundId: "r1", role: "fish", sectorId: "A" },
        { roundId: "r2", role: "control", controlsLotId: "lot2" },
      ],
    },
    {
      lotId: "lot2",
      number: 2,
      anglerId: "ben",
      rounds: [
        { roundId: "r1", role: "control", controlsLotId: "lot1" },
        { roundId: "r2", role: "fish", sectorId: "B" },
      ],
    },
  ];

  it("flattens each lot into one participation per round", () => {
    const parts = lotParticipations(lots);
    expect(parts).toHaveLength(4);
  });

  it("derives the fish/control sets of each lot", () => {
    expect(fishRounds(lots[0])).toEqual(["r1"]);
    expect(controlRounds(lots[0])).toEqual(["r2"]);
    expect(fishRounds(lots[1])).toEqual(["r2"]);
    expect(controlRounds(lots[1])).toEqual(["r1"]);
  });

  it("carries the sector on fish rounds and the controlled lot on control rounds", () => {
    const parts = lotParticipations(lots);
    const ana1 = parts.find((p) => p.lotId === "lot1" && p.roundId === "r1")!;
    expect(ana1.role).toBe("fish");
    expect(ana1.sectorId).toBe("A");
    expect(ana1.controlsLotId).toBeUndefined();

    const ana2 = parts.find((p) => p.lotId === "lot1" && p.roundId === "r2")!;
    expect(ana2.role).toBe("control");
    expect(ana2.controlsLotId).toBe("lot2");
    expect(ana2.sectorId).toBeUndefined();
  });

  it("supports the fish/control role inversion across the phase's rounds", () => {
    const parts = lotParticipations(lots);
    const r1 = participationsByRound(parts, "r1");
    expect(r1.find((p) => p.lotId === "lot1")!.role).toBe("fish");
    expect(r1.find((p) => p.lotId === "lot2")!.role).toBe("control");
    const r2 = participationsByRound(parts, "r2");
    expect(r2.find((p) => p.lotId === "lot1")!.role).toBe("control");
    expect(r2.find((p) => p.lotId === "lot2")!.role).toBe("fish");
  });
});

describe("pair sharing a lot number (issue 35)", () => {
  // A pair's two members draw lots with the SAME number (7).
  const lots: LotAssignment[] = [
    {
      lotId: "lA",
      number: 7,
      anglerId: "ana",
      rounds: [{ roundId: "r1", role: "fish", sectorId: "A" }],
    },
    {
      lotId: "lB",
      number: 7,
      anglerId: "ben",
      rounds: [{ roundId: "r1", role: "fish", sectorId: "B" }],
    },
  ];

  it("groups both members' lots under the shared number", () => {
    const byNumber = lotsByNumber(lots);
    const shared = byNumber.get(7)!;
    expect(shared).toHaveLength(2);
    expect(shared.map((l) => l.anglerId).sort()).toEqual(["ana", "ben"]);
  });

  it("still produces an independent participation (and scorecard) per member", () => {
    const parts = lotParticipations(lots);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.number === 7)).toBe(true);
    expect(parts.map((p) => p.anglerId).sort()).toEqual(["ana", "ben"]);
  });
});
