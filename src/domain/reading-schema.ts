/**
 * Slice 07 — Contract of the structured JSON produced by the AI reading of a
 * scorecard. It is the output the multimodal LLM must return (PRD §7.4) and the
 * input of the checksum validation (slice 08).
 *
 * The concrete MODEL (Claude / GPT-4o vision) is a pending HITL decision; this
 * schema fixes the output format and is used to validate/parse the model's
 * response, whichever it is. Versioned so it can evolve.
 */
import { z } from "zod";

export const READING_SCHEMA_VERSION = 1;

export const readCatchSchema = z.object({
  /** Marked tens digit on the scorecard (0..9). */
  tens: z.number().int().min(0).max(9),
  /** Marked units digit (0..9). */
  units: z.number().int().min(0).max(9),
  /** Handwritten size in cm (may be decimal). */
  handwrittenSize: z.number().positive(),
});

export const scorecardTotalsSchema = z.object({
  legalCatches: z.number().int().min(0),
  undersizedCatches: z.number().int().min(0),
  biggestCatchCm: z.number().min(0),
});

export const readConfidenceSchema = z.object({
  lot: z.number().min(0).max(1),
  catches: z.number().min(0).max(1),
  totals: z.number().min(0).max(1),
});

export const scorecardReadingSchema = z.object({
  lot: z.string().min(1),
  catches: z.array(readCatchSchema),
  totals: scorecardTotalsSchema,
  confidence: readConfidenceSchema,
});

export type ParsedScorecardReading = z.infer<typeof scorecardReadingSchema>;

/** Parses and validates the model's raw JSON. Throws if it breaks the contract. */
export function parseScorecardReading(raw: unknown): ParsedScorecardReading {
  return scorecardReadingSchema.parse(raw);
}
