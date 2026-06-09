/**
 * Issue 18 — Grouping rounds (typically two-by-two) for the standings.
 *
 * Rounds are normally grouped in pairs: the 1st and 2nd round form a group where
 * each participant fishes one round and controls in the other — the fish/control
 * roles invert between the two rounds. The relevant standing is the group's,
 * aggregating the placings each participant earned across the group's rounds with
 * the same FEPyC sum-of-placings engine.
 *
 * Pure: no I/O. The aggregation itself lives in the ranking engine (placings are
 * summed per angler across all the (round, sector) they appear in); this module
 * only decides which rounds belong together and validates the role inversion.
 */

/** A round tagged with its group index (null = ungrouped). */
export interface GroupableRound {
  roundId: string;
  /** Rounds sharing a non-null index form a group; null = ungrouped (singleton). */
  groupIndex: number | null;
}

/** A group of rounds whose standings are aggregated together. */
export interface RoundGroup {
  /** Stable key: `g{index}` for grouped rounds, the round id for ungrouped ones. */
  key: string;
  /** The group index, or null for an ungrouped singleton. */
  groupIndex: number | null;
  roundIds: string[];
}

/**
 * Partitions rounds into groups: rounds with the same non-null `groupIndex` join
 * the same group; an ungrouped round (null) becomes its own singleton. Order of
 * first appearance is preserved, so the result is deterministic.
 */
export function groupRounds(rounds: GroupableRound[]): RoundGroup[] {
  const byIndex = new Map<number, RoundGroup>();
  const result: RoundGroup[] = [];
  for (const r of rounds) {
    if (r.groupIndex === null) {
      result.push({ key: r.roundId, groupIndex: null, roundIds: [r.roundId] });
      continue;
    }
    let group = byIndex.get(r.groupIndex);
    if (!group) {
      group = { key: `g${r.groupIndex}`, groupIndex: r.groupIndex, roundIds: [] };
      byIndex.set(r.groupIndex, group);
      result.push(group);
    }
    group.roundIds.push(r.roundId);
  }
  return result;
}

/** True when at least one group spans more than one round. */
export function hasGroupedRounds(groups: RoundGroup[]): boolean {
  return groups.some((g) => g.roundIds.length > 1);
}

/** A lot's control assignment within a round: which lot it controls, if any. */
export interface ControlAssignment {
  /** The lot fishing this entry. */
  lotId: string;
  /** The lot it controls in this round, if any. */
  controlsLotId: string | null;
}

function controlEdges(entries: ControlAssignment[]): Map<string, string> {
  const edges = new Map<string, string>();
  for (const e of entries) {
    if (e.controlsLotId) edges.set(e.lotId, e.controlsLotId);
  }
  return edges;
}

/**
 * True when round B's control assignments are the inverse of round A's: for every
 * "x controls y" in A there is "y controls x" in B. This is the fish/control role
 * inversion expected between the 1st and 2nd round of a group (issue 18). Both
 * rounds must cover the same control pairs (an empty set is not an inversion).
 */
export function rolesInverted(a: ControlAssignment[], b: ControlAssignment[]): boolean {
  const edgesA = controlEdges(a);
  const edgesB = controlEdges(b);
  if (edgesA.size === 0 || edgesA.size !== edgesB.size) return false;
  for (const [controller, controlled] of edgesA) {
    if (edgesB.get(controlled) !== controller) return false;
  }
  return true;
}
