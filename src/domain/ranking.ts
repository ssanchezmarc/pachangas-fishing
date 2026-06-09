/**
 * Slice 05 — FEPyC aggregation (sum of placings) and individual standings.
 *
 * Rules (PRD §6):
 *  1. Within each (round, sector), anglers are ordered by catch points DESC and a
 *     placing is assigned: 1st = 1 standings point, 2nd = 2, …
 *  2. A points tie inside a sector → the AVERAGE of the disputed placings is
 *     shared (e.g. tied for 2nd and 3rd → 2.5 each).
 *  3. The final standings order by LOWEST sum of placings.
 *  4. Final tiebreaks (configurable, FEPyC preset): highest total catch points;
 *     if still tied, biggest catch.
 *
 * Pure and reproducible (RNF-1). Input order does not affect the result: placing
 * ties use stable criteria, not the input position.
 */
import type { AggregationConfig } from "./types";

/** An angler's participation in a specific (round, sector). */
export interface Participation {
  anglerId: string;
  roundId: string;
  sectorId: string;
  /** Catch points of their scorecard in this round (see scoring.scoreScorecard). */
  catchPoints: number;
  /** Largest catch of their scorecard in this round (final tiebreak). */
  biggestCatchCm: number;
}

/** Placing assigned to a participation within its sector. */
export interface SectorPlacing {
  anglerId: string;
  roundId: string;
  sectorId: string;
  /** Placing (standings point); may be fractional due to ties. */
  placing: number;
}

/** A row of the final individual standings. */
export interface RankingRow {
  anglerId: string;
  /** Position in the table (1 = best); a full tie shares the position. */
  position: number;
  placingsSum: number;
  totalCatchPoints: number;
  biggestCatchCm: number;
}

/**
 * Assigns placings within each (round, sector): ordering by catch points DESC and
 * averaging placings on a tie (rule 2).
 */
export function assignPlacings(participations: Participation[]): SectorPlacing[] {
  const groups = new Map<string, Participation[]>();
  for (const p of participations) {
    const key = `${p.roundId} ${p.sectorId}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }

  const result: SectorPlacing[] = [];
  for (const group of groups.values()) {
    // Stable ordering by catch points DESC.
    const sorted = [...group].sort((a, b) => b.catchPoints - a.catchPoints);

    let i = 0;
    while (i < sorted.length) {
      // Find the tie block (same catch points).
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].catchPoints === sorted[i].catchPoints) {
        j += 1;
      }
      // Disputed positions: (i+1) .. (j+1). Share the average.
      const from = i + 1;
      const to = j + 1;
      const average = (from + to) / 2;
      for (let k = i; k <= j; k++) {
        const p = sorted[k];
        result.push({
          anglerId: p.anglerId,
          roundId: p.roundId,
          sectorId: p.sectorId,
          placing: average,
        });
      }
      i = j + 1;
    }
  }
  return result;
}

/** Per-angler accumulation before ordering the final table. */
interface Accumulated {
  anglerId: string;
  placingsSum: number;
  totalCatchPoints: number;
  biggestCatchCm: number;
}

function accumulateByAngler(
  participations: Participation[],
  placings: SectorPlacing[],
): Accumulated[] {
  const placingByKey = new Map<string, number>();
  for (const sp of placings) {
    placingByKey.set(`${sp.anglerId} ${sp.roundId} ${sp.sectorId}`, sp.placing);
  }

  const acc = new Map<string, Accumulated>();
  for (const p of participations) {
    const placing = placingByKey.get(`${p.anglerId} ${p.roundId} ${p.sectorId}`) ?? 0;
    const prev = acc.get(p.anglerId) ?? {
      anglerId: p.anglerId,
      placingsSum: 0,
      totalCatchPoints: 0,
      biggestCatchCm: 0,
    };
    prev.placingsSum += placing;
    prev.totalCatchPoints += p.catchPoints;
    prev.biggestCatchCm = Math.max(prev.biggestCatchCm, p.biggestCatchCm);
    acc.set(p.anglerId, prev);
  }
  return [...acc.values()];
}

/**
 * Compares two accumulations applying: lowest sum of placings wins; then the
 * configured tiebreaks (FEPyC preset). Returns <0 if `a` ranks before `b`.
 */
export function compareForRanking(
  a: Accumulated,
  b: Accumulated,
  config: AggregationConfig,
): number {
  if (a.placingsSum !== b.placingsSum) return a.placingsSum - b.placingsSum;
  for (const criterion of config.tiebreaks) {
    if (criterion === "catchPoints" && a.totalCatchPoints !== b.totalCatchPoints) {
      return b.totalCatchPoints - a.totalCatchPoints; // higher wins
    }
    if (criterion === "biggestCatch" && a.biggestCatchCm !== b.biggestCatchCm) {
      return b.biggestCatchCm - a.biggestCatchCm; // bigger wins
    }
  }
  return 0; // full tie
}

/** Builds the individual standings from the participations. */
export function individualRanking(
  participations: Participation[],
  config: AggregationConfig,
): RankingRow[] {
  const placings = assignPlacings(participations);
  const accumulated = accumulateByAngler(participations, placings);

  accumulated.sort((a, b) => {
    const c = compareForRanking(a, b, config);
    if (c !== 0) return c;
    // Deterministic final tiebreak by id, for stable reproducibility.
    return a.anglerId < b.anglerId ? -1 : a.anglerId > b.anglerId ? 1 : 0;
  });

  const rows: RankingRow[] = [];
  for (let idx = 0; idx < accumulated.length; idx++) {
    const a = accumulated[idx];
    // Full tie with the previous one → share the position.
    let position = idx + 1;
    if (idx > 0 && compareForRanking(accumulated[idx - 1], a, config) === 0) {
      position = rows[idx - 1].position;
    }
    rows.push({
      anglerId: a.anglerId,
      position,
      placingsSum: a.placingsSum,
      totalCatchPoints: a.totalCatchPoints,
      biggestCatchCm: a.biggestCatchCm,
    });
  }
  return rows;
}
