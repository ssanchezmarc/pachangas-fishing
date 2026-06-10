/**
 * Issues 20 + 35 — Lots and their per-round participations.
 *
 * A lot has a number and is assigned to an angler (in a pairs competition both
 * members of a pair draw a lot with the SAME number — issue 35). The lot defines,
 * per round of the competition, its **role**: it either **fishes** a sector or
 * **controls** another lot. That per-round role is what supports the fish/control
 * inversion between the rounds of a phase (issues 18/31): a lot fishes round 1 and
 * controls round 2, its paired lot does the inverse.
 *
 * lot ↔ sector (issue 35 decision, 2026-06-09): sectors are defined first, then
 * assigned to a lot's fishing role per round. So a `fish` map carries its sector; a
 * `control` map carries the controlled lot.
 *
 * Pure and I/O-free. The standings engine consumes only the `fish` participations
 * (a controller does not score in the round they control).
 */

export type LotRole = "fish" | "control";

/** What a lot does in a single round: fish a sector, or control another lot. */
export interface LotRoundMap {
  roundId: string;
  role: LotRole;
  /** Sector fished — required when role is "fish". */
  sectorId?: string;
  /** The lot this lot controls — required when role is "control". */
  controlsLotId?: string;
}

/** A lot drawn by an angler, with its per-round map. */
export interface LotAssignment {
  lotId: string;
  number: number;
  anglerId: string;
  rounds: LotRoundMap[];
}

/** A lot's participation in one round (flattened). */
export interface LotParticipation {
  lotId: string;
  number: number;
  anglerId: string;
  roundId: string;
  role: LotRole;
  sectorId?: string;
  controlsLotId?: string;
}

/** Flattens lot assignments into per-round participations. */
export function lotParticipations(lots: LotAssignment[]): LotParticipation[] {
  return lots.flatMap((lot) =>
    lot.rounds.map((r) => ({
      lotId: lot.lotId,
      number: lot.number,
      anglerId: lot.anglerId,
      roundId: r.roundId,
      role: r.role,
      sectorId: r.sectorId,
      controlsLotId: r.controlsLotId,
    })),
  );
}

/** Participations of a given round, keyed for quick lookup. */
export function participationsByRound(
  participations: LotParticipation[],
  roundId: string,
): LotParticipation[] {
  return participations.filter((p) => p.roundId === roundId);
}

/** Round ids where the lot fishes. */
export function fishRounds(lot: LotAssignment): string[] {
  return lot.rounds.filter((r) => r.role === "fish").map((r) => r.roundId);
}

/** Round ids where the lot controls another lot. */
export function controlRounds(lot: LotAssignment): string[] {
  return lot.rounds.filter((r) => r.role === "control").map((r) => r.roundId);
}

/**
 * Issue 35 — Groups lots that share a number into a single assignment unit. In a
 * pairs competition the two members of a pair draw lots with the same number, so a
 * number maps to (usually) two lots. Order of first appearance is preserved.
 */
export function lotsByNumber(lots: LotAssignment[]): Map<number, LotAssignment[]> {
  const byNumber = new Map<number, LotAssignment[]>();
  for (const lot of lots) {
    const list = byNumber.get(lot.number);
    if (list) list.push(lot);
    else byNumber.set(lot.number, [lot]);
  }
  return byNumber;
}
