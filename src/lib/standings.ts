/**
 * Assembles a round's standings from raw data (scorecards + catches + roster +
 * pairs) using the domain engine. Catches are the source of truth: points are
 * always recomputed (exact and reproducible, RNF-1), never trusting cached values.
 *
 * Pure function: receives already-loaded data and returns the standings. Supabase
 * access lives in the server loader (data.ts), which calls here.
 */
import { scoreScorecard } from "@/domain/scoring";
import { individualRanking, type Participation, type RankingRow } from "@/domain/ranking";
import { pairsRanking, type Pair, type PairRankingRow } from "@/domain/pairs";
import type { AggregationConfig, CompetitionType, ScoringConfig, Catch } from "@/domain/types";

/** A scorecard with its roster context, ready to score. */
export interface ScorecardToRank {
  anglerId: string;
  sectorId: string;
  catches: Catch[];
}

export interface StandingsInput {
  roundId: string;
  /**
   * Competition type (issue 16). Decides which standings are produced: a pairs
   * competition skips the individual table, an individual one skips pairs. When
   * omitted, both tables are computed (the pure-engine default).
   */
  type?: CompetitionType;
  config: ScoringConfig;
  aggregation: AggregationConfig;
  scorecards: ScorecardToRank[];
  pairs: Pair[];
}

export interface RoundStandings {
  individual: RankingRow[];
  pairs: PairRankingRow[];
}

/**
 * Ranks pre-built participations into the standings the competition type calls for
 * (issue 16). The individual ranking is always computed (the pairs result derives
 * from it); with no type both tables are returned.
 */
function rankParticipations(
  participations: Participation[],
  pairs: Pair[],
  aggregation: AggregationConfig,
  type?: CompetitionType,
): RoundStandings {
  const individualRows = individualRanking(participations, aggregation);
  if (type === "individual") return { individual: individualRows, pairs: [] };
  const pairRows = pairsRanking(individualRows, pairs, aggregation);
  return { individual: type === "pairs" ? [] : individualRows, pairs: pairRows };
}

export function buildRoundStandings(input: StandingsInput): RoundStandings {
  const participations: Participation[] = input.scorecards.map((s) => {
    const r = scoreScorecard(s.catches, input.config);
    return {
      anglerId: s.anglerId,
      roundId: input.roundId,
      sectorId: s.sectorId,
      catchPoints: r.catchPoints,
      biggestCatchCm: r.biggestCatchCm,
    };
  });
  return rankParticipations(participations, input.pairs, input.aggregation, input.type);
}

/** A scorecard carrying its own round (for competition-wide aggregation, issue 15). */
export interface CompetitionScorecardToRank extends ScorecardToRank {
  roundId: string;
}

export interface CompetitionStandingsInput {
  type?: CompetitionType;
  config: ScoringConfig;
  aggregation: AggregationConfig;
  scorecards: CompetitionScorecardToRank[];
  pairs: Pair[];
}

/**
 * Issue 15 — Competition standings: aggregates every round of the competition with
 * the same FEPyC sum-of-placings engine. Placings are assigned per (round, sector)
 * and summed across all the angler's/pair's rounds — exactly the federated rule.
 */
export function buildCompetitionStandings(input: CompetitionStandingsInput): RoundStandings {
  const participations: Participation[] = input.scorecards.map((s) => {
    const r = scoreScorecard(s.catches, input.config);
    return {
      anglerId: s.anglerId,
      roundId: s.roundId,
      sectorId: s.sectorId,
      catchPoints: r.catchPoints,
      biggestCatchCm: r.biggestCatchCm,
    };
  });
  return rankParticipations(participations, input.pairs, input.aggregation, input.type);
}

/**
 * Issue 18 — Group standings: aggregates the rounds of a single group with the same
 * FEPyC sum-of-placings engine. A group is just a subset of a competition's rounds,
 * so the math is identical to {@link buildCompetitionStandings} restricted to the
 * group's scorecards. The fish/control role inversion between the group's rounds
 * (issue 18) is a property of the roster data, not a scoring input, so it does not
 * change the computation here.
 */
export function buildGroupStandings(input: CompetitionStandingsInput): RoundStandings {
  return buildCompetitionStandings(input);
}
