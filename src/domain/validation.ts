/**
 * Slice 08 — Automatic checksum validation (pure logic).
 *
 * The scorecard is self-validating (PRD §2): each catch has 3 signals (marked
 * tens, marked units, handwritten size) and the footer has totals acting as a
 * checksum. This validation cross-checks the AI-read detail against:
 *   - the footer totals (legal catches, undersized catches, biggest catch),
 *   - the consistency of the 3 signals per catch,
 *   - the existence of the lot in the round roster.
 * And, combined with per-field self-confidence, decides whether the scorecard is
 * `auto` (matches and above threshold) or `flagged` (to the HITL queue, slice 09).
 *
 * Pure and I/O-free: it does not call the LLM. The LLM (slice 07, HITL) produces
 * the `ScorecardReading`; here it is only validated.
 */
import { isUndersized } from "./scoring";
import type { ScoringConfig } from "./types";

/** A catch as read by the AI: the 3 signals of the scorecard. */
export interface ReadCatch {
  tens: number; // marked tens digit (0..9)
  units: number; // marked units digit (0..9)
  handwrittenSize: number; // handwritten size in cm
}

/** Footer totals of the scorecard (checksum). */
export interface ScorecardTotals {
  legalCatches: number;
  undersizedCatches: number;
  biggestCatchCm: number;
}

/** Per-field confidence reported by the LLM (0..1). */
export interface ReadConfidence {
  lot: number;
  catches: number; // aggregated/min confidence of the catches
  totals: number;
}

/** Structured output of the AI reading of a scorecard (slice 07). */
export interface ScorecardReading {
  lot: string;
  catches: ReadCatch[];
  totals: ScorecardTotals;
  confidence: ReadConfidence;
}

export type ValidationStatus = "auto" | "flagged";

/**
 * A flagging reason as a message key + params, so it can be rendered in the
 * active locale (i18n, issue 14). `code` maps to the `issue.<code>` message key.
 */
export interface ValidationIssue {
  code: string;
  params?: Record<string, string | number>;
}

export interface ValidationResult {
  status: ValidationStatus;
  /** true if all checksum checks match. */
  checksumOk: boolean;
  /** Reasons the scorecard is flagged (empty if auto). */
  issues: ValidationIssue[];
}

export interface ValidationOptions {
  config: ScoringConfig;
  /** Valid lot numbers of the active round roster (issue 20). */
  rosterLots: Set<string>;
  /** Minimum per-field confidence threshold (0..1). Default 0.9. */
  confidenceThreshold?: number;
}

/** Do the 3 signals of the catch agree? (tens*10 + units == integer part). */
export function signalsConsistent(item: ReadCatch): boolean {
  const marked = item.tens * 10 + item.units;
  return marked === Math.trunc(item.handwrittenSize);
}

export function validateScorecard(
  reading: ScorecardReading,
  options: ValidationOptions,
): ValidationResult {
  const threshold = options.confidenceThreshold ?? 0.9;
  const issues: ValidationIssue[] = [];

  // 1. Consistency of the 3 signals per catch.
  reading.catches.forEach((item, i) => {
    if (!signalsConsistent(item)) {
      issues.push({
        code: "signalsMismatch",
        params: { index: i + 1, tens: item.tens, units: item.units, size: item.handwrittenSize },
      });
    }
  });

  // 2. Detail ↔ footer totals.
  let legalCatches = 0;
  let undersizedCatches = 0;
  let biggestCatchCm = 0;
  for (const item of reading.catches) {
    if (isUndersized(item.handwrittenSize, options.config)) undersizedCatches += 1;
    else legalCatches += 1;
    biggestCatchCm = Math.max(biggestCatchCm, item.handwrittenSize);
  }
  if (legalCatches !== reading.totals.legalCatches) {
    issues.push({
      code: "legalCatchesMismatch",
      params: { read: legalCatches, total: reading.totals.legalCatches },
    });
  }
  if (undersizedCatches !== reading.totals.undersizedCatches) {
    issues.push({
      code: "undersizedMismatch",
      params: { read: undersizedCatches, total: reading.totals.undersizedCatches },
    });
  }
  if (biggestCatchCm !== reading.totals.biggestCatchCm) {
    issues.push({
      code: "biggestCatchMismatch",
      params: { read: biggestCatchCm, total: reading.totals.biggestCatchCm },
    });
  }

  // 3. The lot exists in the roster.
  if (!options.rosterLots.has(reading.lot)) {
    issues.push({ code: "lotNotInRoster", params: { lot: reading.lot } });
  }

  const checksumOk = issues.length === 0;

  // 4. Per-field confidence.
  const c = reading.confidence;
  if (c.lot < threshold) issues.push({ code: "lowLotConfidence", params: { value: c.lot } });
  if (c.catches < threshold)
    issues.push({ code: "lowCatchesConfidence", params: { value: c.catches } });
  if (c.totals < threshold)
    issues.push({ code: "lowTotalsConfidence", params: { value: c.totals } });

  return {
    status: issues.length === 0 ? "auto" : "flagged",
    checksumOk,
    issues,
  };
}
