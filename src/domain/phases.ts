/**
 * Issue 31 — Phases ("Fase A", "Fase B", …).
 *
 * The grouping of rounds introduced in issue 18 (stored as a 1-based `group_index`)
 * is, in domain language, a **phase**, labelled by a letter. The concept and the
 * aggregation engine are unchanged (see {@link ./round-groups}); this module only
 * maps the index to its presentation letter.
 *
 * Pure: no I/O. 1 → "A", 2 → "B", …, 26 → "Z", 27 → "AA" (Excel-style), so an
 * arbitrary number of phases is supported. Non-positive or non-integer indices fall
 * back to their string form (they should never occur — the index is a validated
 * positive integer).
 */
export function phaseLabel(index: number): string {
  if (!Number.isInteger(index) || index <= 0) return String(index);
  let n = index;
  let label = "";
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

/**
 * Issue 53 — Inverse of {@link phaseLabel}: a phase letter ("A", "B", …, "AA")
 * back to its 1-based index. Case-insensitive, trims surrounding space. Returns
 * `null` for empty or non-letter input (so the caller can treat it as "no phase").
 */
export function phaseIndex(label: string): number | null {
  const s = label.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n > 0 ? n : null;
}
