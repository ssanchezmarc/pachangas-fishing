import { describe, expect, it } from "vitest";
import { ALTO_CARRION_PRESET, FEPYC_AGGREGATION_PRESET } from "@/domain/types";
import {
  buildRoundStandings,
  buildCompetitionStandings,
  buildGroupStandings,
  type StandingsInput,
} from "./standings";

describe("buildRoundStandings (domain integration)", () => {
  it("computes individual and pairs end-to-end from catches", () => {
    const input: StandingsInput = {
      roundId: "r1",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      scorecards: [
        // sector A
        { anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 30 }, { sizeCm: 25 }] },
        { anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 20 }] },
        // sector B
        { anglerId: "cris", sectorId: "B", catches: [{ sizeCm: 28 }] },
        { anglerId: "dani", sectorId: "B", catches: [{ sizeCm: 18 }] }, // undersized
      ],
      pairs: [
        { pairId: "duo1", members: ["ana", "dani"] },
        { pairId: "duo2", members: ["ben", "cris"] },
      ],
    };
    const { individual, pairs } = buildRoundStandings(input);

    // In sector A, ana (2 big catches) beats ben.
    const ana = individual.find((f) => f.anglerId === "ana")!;
    const ben = individual.find((f) => f.anglerId === "ben")!;
    expect(ana.placingsSum).toBe(1);
    expect(ben.placingsSum).toBe(2);

    // duo1 (ana 1st + dani 2nd = 3) vs duo2 (ben 2nd + cris 1st = 3): placings tie.
    // Catch-points tiebreak: ana+dani have far more catch points → duo1 1st.
    expect(pairs[0].pairId).toBe("duo1");
    expect(pairs[0].placingsSum).toBe(3);
  });

  it("type=pairs returns only the pairs table (issue 16)", () => {
    const base = {
      roundId: "r1",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      scorecards: [
        { anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 30 }] },
        { anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 20 }] },
      ],
      pairs: [{ pairId: "duo1", members: ["ana", "ben"] as [string, string] }],
    };
    const { individual, pairs } = buildRoundStandings({ ...base, type: "pairs" });
    expect(individual).toHaveLength(0);
    expect(pairs).toHaveLength(1);
  });

  it("type=individual returns only the individual table (issue 16)", () => {
    const { individual, pairs } = buildRoundStandings({
      roundId: "r1",
      type: "individual",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      scorecards: [
        { anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 30 }] },
        { anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 20 }] },
      ],
      pairs: [{ pairId: "duo1", members: ["ana", "ben"] }],
    });
    expect(individual).toHaveLength(2);
    expect(pairs).toHaveLength(0);
  });

  it("aggregates placings across rounds for the competition (issue 15)", () => {
    // 2 rounds, same sector A. ana wins r1 (1st) and loses r2 (2nd); ben the
    // opposite. Competition sum: ana 1+2=3, ben 2+1=3 → tie on placings, broken by
    // total catch points (ana has the single biggest haul) → ana 1st.
    const { individual } = buildCompetitionStandings({
      type: "individual",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      pairs: [],
      scorecards: [
        { roundId: "r1", anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 40 }] },
        { roundId: "r1", anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 20 }] },
        { roundId: "r2", anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 21 }] },
        { roundId: "r2", anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 30 }] },
      ],
    });
    const ana = individual.find((f) => f.anglerId === "ana")!;
    const ben = individual.find((f) => f.anglerId === "ben")!;
    expect(ana.placingsSum).toBe(3);
    expect(ben.placingsSum).toBe(3);
    expect(ana.position).toBe(1);
  });

  it("computes the group standing aggregating its 2 rounds with inverted roles (issue 18)", () => {
    // A group of 2 rounds. Each angler fishes both; between r1 and r2 the
    // fish/control roles invert (ana controls ben in r1, ben controls ana in r2).
    // Control is a witnessing duty, not a scoring input, so the group standing
    // depends only on catch points: ana wins r1, ben wins r2 → placings tie 1+2,
    // broken by total catch points (ana's 40 cm haul is the biggest) → ana 1st.
    const { individual } = buildGroupStandings({
      type: "individual",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      pairs: [],
      scorecards: [
        { roundId: "r1", anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 40 }] }, // 1st r1
        { roundId: "r1", anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 20 }] }, // 2nd r1
        { roundId: "r2", anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 21 }] }, // 2nd r2
        { roundId: "r2", anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 30 }] }, // 1st r2
      ],
    });
    const ana = individual.find((f) => f.anglerId === "ana")!;
    const ben = individual.find((f) => f.anglerId === "ben")!;
    expect(ana.placingsSum).toBe(3);
    expect(ben.placingsSum).toBe(3);
    expect(ana.position).toBe(1);
    // A single round of the group would NOT show this tie: in r1 alone ana=1, ben=2.
    const { individual: r1Only } = buildRoundStandings({
      roundId: "r1",
      type: "individual",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      pairs: [],
      scorecards: [
        { anglerId: "ana", sectorId: "A", catches: [{ sizeCm: 40 }] },
        { anglerId: "ben", sectorId: "A", catches: [{ sizeCm: 20 }] },
      ],
    });
    expect(r1Only.find((f) => f.anglerId === "ben")!.placingsSum).toBe(2);
  });

  it("empty round → empty standings", () => {
    const { individual, pairs } = buildRoundStandings({
      roundId: "r1",
      config: ALTO_CARRION_PRESET,
      aggregation: FEPYC_AGGREGATION_PRESET,
      scorecards: [],
      pairs: [],
    });
    expect(individual).toHaveLength(0);
    expect(pairs).toHaveLength(0);
  });
});
