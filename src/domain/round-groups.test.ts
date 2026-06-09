import { describe, expect, it } from "vitest";
import {
  groupRounds,
  hasGroupedRounds,
  rolesInverted,
  type ControlAssignment,
} from "./round-groups";

describe("groupRounds", () => {
  it("groups rounds two-by-two by their group index", () => {
    const groups = groupRounds([
      { roundId: "r1", groupIndex: 1 },
      { roundId: "r2", groupIndex: 1 },
      { roundId: "r3", groupIndex: 2 },
      { roundId: "r4", groupIndex: 2 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ key: "g1", groupIndex: 1, roundIds: ["r1", "r2"] });
    expect(groups[1]).toEqual({ key: "g2", groupIndex: 2, roundIds: ["r3", "r4"] });
    expect(hasGroupedRounds(groups)).toBe(true);
  });

  it("keeps ungrouped rounds as their own singletons", () => {
    const groups = groupRounds([
      { roundId: "r1", groupIndex: null },
      { roundId: "r2", groupIndex: 1 },
      { roundId: "r3", groupIndex: 1 },
    ]);
    expect(groups[0]).toEqual({ key: "r1", groupIndex: null, roundIds: ["r1"] });
    expect(groups[1].roundIds).toEqual(["r2", "r3"]);
  });

  it("reports no grouping when every round stands alone", () => {
    const groups = groupRounds([
      { roundId: "r1", groupIndex: null },
      { roundId: "r2", groupIndex: null },
    ]);
    expect(hasGroupedRounds(groups)).toBe(false);
  });
});

describe("rolesInverted", () => {
  it("detects the fish/control inversion between the two rounds of a group", () => {
    // Round 1: lot 1 controls lot 2, lot 2 controls lot 1 (a pair witnessing each
    // other is already symmetric); use an asymmetric 3-cycle to make it meaningful.
    const roundA: ControlAssignment[] = [
      { lotId: "1", controlsLotId: "2" },
      { lotId: "2", controlsLotId: "3" },
      { lotId: "3", controlsLotId: "1" },
    ];
    // Round 2: roles inverted — whoever was controlled now controls.
    const roundB: ControlAssignment[] = [
      { lotId: "2", controlsLotId: "1" },
      { lotId: "3", controlsLotId: "2" },
      { lotId: "1", controlsLotId: "3" },
    ];
    expect(rolesInverted(roundA, roundB)).toBe(true);
  });

  it("rejects identical (non-inverted) control assignments", () => {
    const round: ControlAssignment[] = [
      { lotId: "1", controlsLotId: "2" },
      { lotId: "2", controlsLotId: "1" },
    ];
    // Same edges in both rounds: 1→2 and 2→1. Inverting 1→2 needs 2→1 (present) and
    // inverting 2→1 needs 1→2 (present), so a mutual pair IS its own inversion.
    expect(rolesInverted(round, round)).toBe(true);
    // But an asymmetric assignment repeated unchanged is not an inversion.
    const asymA: ControlAssignment[] = [
      { lotId: "1", controlsLotId: "2" },
      { lotId: "2", controlsLotId: "3" },
      { lotId: "3", controlsLotId: "1" },
    ];
    expect(rolesInverted(asymA, asymA)).toBe(false);
  });

  it("is false when there are no control assignments", () => {
    expect(rolesInverted([], [])).toBe(false);
  });
});
