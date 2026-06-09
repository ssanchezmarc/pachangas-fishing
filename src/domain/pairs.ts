/**
 * Slice 06 — Pairs standings (Liga Duos / pairs league).
 *
 * A pair (Duo) is 2 anglers. Its result is DERIVED from the individual standings:
 *  - the pair's placingsSum = sum of its 2 members' placings
 *  - totalCatchPoints = sum of both
 *  - biggestCatchCm = the larger of the two
 * And it is ordered with the same rules as the individual (lowest sum wins +
 * FEPyC tiebreaks), reusing `compareForRanking` (PRD §6).
 */
import { compareForRanking, type RankingRow } from "./ranking";
import type { AggregationConfig } from "./types";

export interface Pair {
  pairId: string;
  members: [string, string];
}

export interface PairRankingRow {
  pairId: string;
  position: number;
  placingsSum: number;
  totalCatchPoints: number;
  biggestCatchCm: number;
}

/**
 * Derives the pairs standings from the already-computed individual standings
 * (rows indexable by anglerId).
 */
export function pairsRanking(
  individual: RankingRow[],
  pairs: Pair[],
  config: AggregationConfig,
): PairRankingRow[] {
  const byAngler = new Map(individual.map((f) => [f.anglerId, f]));

  const accumulated = pairs.map((pair) => {
    const [m1, m2] = pair.members;
    const f1 = byAngler.get(m1);
    const f2 = byAngler.get(m2);
    return {
      pairId: pair.pairId,
      placingsSum: (f1?.placingsSum ?? 0) + (f2?.placingsSum ?? 0),
      totalCatchPoints: (f1?.totalCatchPoints ?? 0) + (f2?.totalCatchPoints ?? 0),
      biggestCatchCm: Math.max(f1?.biggestCatchCm ?? 0, f2?.biggestCatchCm ?? 0),
    };
  });

  accumulated.sort((a, b) => {
    const c = compareForRanking(
      { anglerId: a.pairId, ...a },
      { anglerId: b.pairId, ...b },
      config,
    );
    if (c !== 0) return c;
    return a.pairId < b.pairId ? -1 : a.pairId > b.pairId ? 1 : 0;
  });

  const rows: PairRankingRow[] = [];
  for (let idx = 0; idx < accumulated.length; idx++) {
    const a = accumulated[idx];
    let position = idx + 1;
    if (
      idx > 0 &&
      compareForRanking(
        { anglerId: "", ...accumulated[idx - 1] },
        { anglerId: "", ...a },
        config,
      ) === 0
    ) {
      position = rows[idx - 1].position;
    }
    rows.push({ ...a, position });
  }
  return rows;
}
