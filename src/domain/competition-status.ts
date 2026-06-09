/**
 * Issue 28 — Competition lifecycle (pure).
 *
 *   draft → open → in_progress → provisional → final → closed
 *
 * - `draft`: registered but not public (organizers only).
 * - `open`: public; participants shown.
 * - `in_progress`: the event day has arrived.
 * - `provisional`: provisional standings published.
 * - `final`: finished.
 * - `closed`: hidden from the public view, still visible to organizers.
 *
 * Transitions are free in any direction for now (the PRD lets them be restricted
 * later). Public visibility hides `draft` and `closed`.
 */
import type { CompetitionStatus } from "@/lib/supabase/types";

export const COMPETITION_STATUSES: CompetitionStatus[] = [
  "draft",
  "open",
  "in_progress",
  "provisional",
  "final",
  "closed",
];

/** Statuses listed/opened to the public (issue 28). */
export const PUBLIC_COMPETITION_STATUSES: CompetitionStatus[] = [
  "open",
  "in_progress",
  "provisional",
  "final",
];

export function isPubliclyVisible(status: CompetitionStatus): boolean {
  return PUBLIC_COMPETITION_STATUSES.includes(status);
}

/** Any → any is allowed for now (no restriction). */
export function canTransitionCompetition(
  _from: CompetitionStatus,
  to: CompetitionStatus,
): boolean {
  return COMPETITION_STATUSES.includes(to);
}
