import { describe, expect, it } from "vitest";
import { lotParticipations, participationsByRound, type LotAssignment } from "./lots";

describe("lots → participations (issue 20)", () => {
  // Two lots in a 2-round group with fish/control role inversion (issue 18):
  // round r1: lot 1 fishes A controlling lot 2; round r2 roles invert.
  const lots: LotAssignment[] = [
    {
      lotId: "lot1",
      number: 1,
      anglerId: "ana",
      rounds: [
        { roundId: "r1", sectorId: "A", controlsLotId: "lot2" },
        { roundId: "r2", sectorId: "B", controlsLotId: undefined },
      ],
    },
    {
      lotId: "lot2",
      number: 2,
      anglerId: "ben",
      rounds: [
        { roundId: "r1", sectorId: "A", controlsLotId: undefined },
        { roundId: "r2", sectorId: "B", controlsLotId: "lot1" },
      ],
    },
  ];

  it("flattens each lot into one participation per round", () => {
    const parts = lotParticipations(lots);
    expect(parts).toHaveLength(4);
    expect(parts.map((p) => p.anglerId).sort()).toEqual(["ana", "ana", "ben", "ben"]);
  });

  it("derives the sector each lot fishes per round", () => {
    const parts = lotParticipations(lots);
    const ana1 = parts.find((p) => p.anglerId === "ana" && p.roundId === "r1")!;
    expect(ana1.sectorId).toBe("A");
    const ana2 = parts.find((p) => p.anglerId === "ana" && p.roundId === "r2")!;
    expect(ana2.sectorId).toBe("B");
  });

  it("supports the fish/control role inversion across the group's rounds", () => {
    const parts = lotParticipations(lots);
    // r1: lot1 controls lot2, lot2 controls nobody.
    const r1 = participationsByRound(parts, "r1");
    expect(r1.find((p) => p.lotId === "lot1")!.controlsLotId).toBe("lot2");
    expect(r1.find((p) => p.lotId === "lot2")!.controlsLotId).toBeUndefined();
    // r2: inverted — lot2 controls lot1.
    const r2 = participationsByRound(parts, "r2");
    expect(r2.find((p) => p.lotId === "lot2")!.controlsLotId).toBe("lot1");
    expect(r2.find((p) => p.lotId === "lot1")!.controlsLotId).toBeUndefined();
  });
});
