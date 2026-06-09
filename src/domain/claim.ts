/**
 * Issue 25 — Claim resolution (pure).
 *
 * A claim against a scorecard starts `open` and is resolved or rejected by the
 * organizers; both are terminal. This models the lifecycle so the server action
 * and tests share one source of truth.
 */
import type { ClaimStatus } from "@/lib/supabase/types";

/** Terminal resolutions an organizer can apply to an open claim. */
export type ClaimResolution = "resolved" | "rejected";

export function isResolution(value: string): value is ClaimResolution {
  return value === "resolved" || value === "rejected";
}

/** Can a claim in `status` still be resolved/rejected? Only while open. */
export function canResolveClaim(status: ClaimStatus): boolean {
  return status === "open";
}
