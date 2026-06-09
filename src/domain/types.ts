/**
 * Domain types for the fishing-competition standings engine.
 *
 * Domain glossary (PRD §5): `club`, `competition`, `round`, `sector`, `angler`,
 * `pair`, `scorecard`, `catch`, `lot`. (Originally Spanish: manga, plica, pieza,
 * pescador, pareja, lote — kept here as the English domain vocabulary.)
 *
 * This module is pure: no Next.js, Supabase or I/O. It is the core that Phase 0
 * validates (exact, reproducible standings) before any AI is added.
 */

/** Rounding rule applied to the catch size for the size formula. */
export type RoundingRule = "up" | "down" | "none";

/**
 * A competition is either individual or pairs (issue 16). The type decides which
 * standings are computed and displayed: a pairs competition shows only the pairs
 * standings, an individual one only the individual standings.
 */
export type CompetitionType = "individual" | "pairs";

/**
 * Declarative scoring configuration, per competition (PRD §6).
 * The default preset matches the real scorecard "VII Liga Duos Alto Carrión 2026".
 */
export interface ScoringConfig {
  /** Minimum legal size in cm; below this a catch is "undersized". */
  minSizeCm: number;
  /** Base points for a valid catch (preset: 100). */
  validCatchBasePoints: number;
  /**
   * Factor multiplying the cube of the rounded size.
   * Preset: 1/100 → `points = 100 + cm³/100`.
   */
  sizeFactor: number;
  /** Fixed points for an undersized catch (preset: 60). */
  undersizedCatchPoints: number;
  /** Size rounding rule (preset: round up to the cm). */
  rounding: RoundingRule;
}

/** Default preset: the one from the real scorecard (PRD §6). */
export const ALTO_CARRION_PRESET: ScoringConfig = {
  minSizeCm: 19,
  validCatchBasePoints: 100,
  sizeFactor: 1 / 100,
  undersizedCatchPoints: 60,
  rounding: "up",
};

/** A catch as recorded (after AI reading or manual entry). */
export interface Catch {
  /** Handwritten size in cm (may be decimal: 19.3). */
  sizeCm: number;
}

/** Tiebreak criteria applied from most to least relevant. */
export type TiebreakCriterion = "catchPoints" | "biggestCatch";

/** Aggregation and tiebreak configuration, per competition (PRD §6). */
export interface AggregationConfig {
  /**
   * Final-standings tiebreaks, in order. FEPyC preset: highest total catch
   * points → biggest catch.
   */
  tiebreaks: TiebreakCriterion[];
}

export const FEPYC_AGGREGATION_PRESET: AggregationConfig = {
  tiebreaks: ["catchPoints", "biggestCatch"],
};
