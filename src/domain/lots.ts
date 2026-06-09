/**
 * Issue 20 — Lots (the sorteo draw) → per-round participations.
 *
 * A lot is drawn at competition level and determines, round by round, which sector
 * its angler fishes and which lot they control. This module expands a lot's
 * round map into the flat per-round participations the standings engine consumes,
 * supporting the fish/control role inversion of grouped rounds (issue 18): the
 * controlled lot simply differs per round.
 *
 * Pure and I/O-free.
 */

/** What a lot does in a single round: fish a sector, control another lot. */
export interface LotRoundMap {
  roundId: string;
  sectorId: string;
  /** The lot this lot controls in that round (undefined if it controls nobody). */
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
  sectorId: string;
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
