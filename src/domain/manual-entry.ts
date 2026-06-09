/**
 * Issue 23 — Manual scorecard entry in the real plica format.
 *
 * The real scorecard records, per legal measure (cm), how many fish of that size
 * were caught (sizes never carry decimals — always rounded up to the cm), plus a
 * count of undersized fish. This module expands that compact form into the flat
 * list of catches the scoring engine consumes, applying the round-up and a
 * representative undersized size (below the minimum, so it scores as undersized).
 *
 * Pure and I/O-free.
 */
import type { Catch, ScoringConfig } from "./types";

/** One row of the real plica: `quantity` fish measuring `sizeCm`. */
export interface MeasureRow {
  sizeCm: number;
  quantity: number;
}

/**
 * Expands measure rows + an undersized count into individual catches. Legal sizes
 * are rounded up to the cm (the plica never has decimals). Undersized fish are
 * materialised at a size just below the minimum so the engine scores them as
 * undersized without needing their real size (the plica only records the count).
 */
export function expandMeasures(
  rows: MeasureRow[],
  undersizedCount: number,
  config: ScoringConfig,
): Catch[] {
  const catches: Catch[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.sizeCm) || !Number.isInteger(row.quantity) || row.quantity < 0) {
      throw new Error("Each measure needs a size and a non-negative integer quantity.");
    }
    const size = Math.ceil(row.sizeCm);
    for (let i = 0; i < row.quantity; i++) catches.push({ sizeCm: size });
  }
  if (!Number.isInteger(undersizedCount) || undersizedCount < 0) {
    throw new Error("Undersized count must be a non-negative integer.");
  }
  const undersizedSize = Math.max(1, config.minSizeCm - 1);
  for (let i = 0; i < undersizedCount; i++) catches.push({ sizeCm: undersizedSize });
  return catches;
}

/**
 * Parses the textarea form of the measures: one line per measure, "size quantity"
 * (also accepts `x`, `:` or `,` as the separator). Blank lines are ignored.
 */
export function parseMeasureLines(raw: string): MeasureRow[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/[\sx:,]+/).filter((p) => p.length > 0);
      const sizeCm = Number(parts[0]);
      const quantity = Number(parts[1] ?? "1");
      if (Number.isNaN(sizeCm) || Number.isNaN(quantity)) {
        throw new Error(`Invalid measure line: "${line}". Use "size quantity".`);
      }
      return { sizeCm, quantity: Math.trunc(quantity) };
    });
}
