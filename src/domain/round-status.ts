/**
 * Slice 12 — State machine of a round's standings (pure).
 *
 *   open ──publish provisional──▶ provisional ──publish final──▶ final
 *
 * - `open`: scorecards are loaded/corrected; no standings published.
 * - `provisional`: standings published and appeals window open.
 * - `final`: immutable; admits no more changes (RF-11).
 */
import type { RoundStatus } from "@/lib/supabase/types";

const TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  open: ["provisional"],
  // 'appeals' exists in the enum as an operational synonym of provisional; in v1
  // the appeals window lives inside 'provisional'.
  provisional: ["final"],
  appeals: ["final"],
  final: [],
};

export function possibleTransitions(from: RoundStatus): RoundStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: RoundStatus, to: RoundStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Is the round in a state that admits edits (scorecards, corrections)? */
export function allowsEditing(status: RoundStatus): boolean {
  return status !== "final";
}

/** Is the appeals window open? */
export function appealsWindowOpen(status: RoundStatus): boolean {
  return status === "provisional" || status === "appeals";
}
