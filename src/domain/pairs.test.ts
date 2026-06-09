import { describe, expect, it } from "vitest";
import { FEPYC_AGGREGATION_PRESET } from "./types";
import { individualRanking, type Participation } from "./ranking";
import { pairsRanking, type Pair } from "./pairs";

const AGG = FEPYC_AGGREGATION_PRESET;

describe("pairsRanking", () => {
  it("derives the pair by summing its 2 members' placings", () => {
    const ps: Participation[] = [
      // sector s1
      { anglerId: "a", roundId: "r1", sectorId: "s1", catchPoints: 400, biggestCatchCm: 30 }, // 1st
      { anglerId: "b", roundId: "r1", sectorId: "s1", catchPoints: 300, biggestCatchCm: 28 }, // 2nd
      { anglerId: "c", roundId: "r1", sectorId: "s1", catchPoints: 200, biggestCatchCm: 25 }, // 3rd
      { anglerId: "d", roundId: "r1", sectorId: "s1", catchPoints: 100, biggestCatchCm: 22 }, // 4th
    ];
    const ind = individualRanking(ps, AGG);
    const pairs: Pair[] = [
      { pairId: "duo1", members: ["a", "c"] }, // placings 1 + 3 = 4
      { pairId: "duo2", members: ["b", "d"] }, // placings 2 + 4 = 6
    ];
    const cp = pairsRanking(ind, pairs, AGG);
    expect(cp[0].pairId).toBe("duo1");
    expect(cp[0].placingsSum).toBe(4);
    expect(cp[0].totalCatchPoints).toBe(600);
    expect(cp[0].biggestCatchCm).toBe(30);
    expect(cp[1].pairId).toBe("duo2");
    expect(cp[1].placingsSum).toBe(6);
  });

  it("pair tiebreak by total catch points and biggest catch", () => {
    const ps: Participation[] = [
      { anglerId: "a", roundId: "r1", sectorId: "s1", catchPoints: 400, biggestCatchCm: 31 }, // 1st
      { anglerId: "b", roundId: "r1", sectorId: "s1", catchPoints: 300, biggestCatchCm: 20 }, // 2nd
      { anglerId: "c", roundId: "r1", sectorId: "s2", catchPoints: 400, biggestCatchCm: 20 }, // 1st
      { anglerId: "d", roundId: "r1", sectorId: "s2", catchPoints: 300, biggestCatchCm: 20 }, // 2nd
    ];
    const ind = individualRanking(ps, AGG);
    const pairs: Pair[] = [
      { pairId: "duo1", members: ["a", "d"] }, // placings 1+2=3, points 700, catch 31
      { pairId: "duo2", members: ["b", "c"] }, // placings 2+1=3, points 700, catch 20
    ];
    const cp = pairsRanking(ind, pairs, AGG);
    // same sum of placings (3) and same points (700) → biggest catch: duo1 (31)
    expect(cp[0].pairId).toBe("duo1");
  });
});
