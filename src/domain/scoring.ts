/**
 * Slice 04 — Declarative rules engine: points per catch.
 *
 * Default preset (PRD §6):
 *  - Valid catch (≥ minimum size, 19 cm) with round-up to the cm:
 *    `points = 100 + cm³/100`  (19.3 → 20 → 100 + 8000/100 = 180)
 *  - Undersized catch: 60 fixed points.
 *
 * All the maths lives here, parameterised by `ScoringConfig`. No hardcoded preset
 * `if`s: changing the config changes the result without touching code (RF-1).
 */
import type { Catch, ScoringConfig } from "./types";

/** Applies the rounding rule to a size in cm. */
export function roundSize(sizeCm: number, rule: ScoringConfig["rounding"]): number {
  switch (rule) {
    case "up":
      return Math.ceil(sizeCm);
    case "down":
      return Math.floor(sizeCm);
    case "none":
      return sizeCm;
  }
}

/**
 * Is the catch undersized? Decided by the measured (handwritten) size against the
 * minimum size — rounding only affects the points formula, not the legality of
 * the catch.
 */
export function isUndersized(sizeCm: number, config: ScoringConfig): boolean {
  return sizeCm < config.minSizeCm;
}

/** Catch points for a single catch. */
export function catchPoints(item: Catch, config: ScoringConfig): number {
  if (isUndersized(item.sizeCm, config)) {
    return config.undersizedCatchPoints;
  }
  const cm = roundSize(item.sizeCm, config.rounding);
  return config.validCatchBasePoints + cm * cm * cm * config.sizeFactor;
}

/** Breakdown of a full scorecard's computation. */
export interface ScorecardResult {
  /** Sum of catch points across all catches. */
  catchPoints: number;
  /** Number of valid (legal-sized) catches. */
  legalCatches: number;
  /** Number of undersized catches. */
  undersizedCatches: number;
  /** Largest handwritten size on the scorecard (0 if no catches). Final tiebreak. */
  biggestCatchCm: number;
}

/** Computes the catch points and derived totals of a scorecard. */
export function scoreScorecard(catches: Catch[], config: ScoringConfig): ScorecardResult {
  let totalPoints = 0;
  let legalCatches = 0;
  let undersizedCatches = 0;
  let biggestCatchCm = 0;

  for (const item of catches) {
    totalPoints += catchPoints(item, config);
    if (isUndersized(item.sizeCm, config)) {
      undersizedCatches += 1;
    } else {
      legalCatches += 1;
    }
    if (item.sizeCm > biggestCatchCm) {
      biggestCatchCm = item.sizeCm;
    }
  }

  return { catchPoints: totalPoints, legalCatches, undersizedCatches, biggestCatchCm };
}
