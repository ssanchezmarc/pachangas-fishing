/**
 * Database types (minimal, hand-written for the Phase 0 model). In a project with
 * provisioned Supabase these would be generated with
 * `supabase gen types typescript`. Here they cover migrations 0001-0003.
 */
import type { AggregationConfig, CompetitionType, ScoringConfig } from "@/domain/types";
import type { ValidationIssue } from "@/domain/validation";

export type RoundStatus = "open" | "provisional" | "appeals" | "final";
export type ScorecardStatus = "draft" | "auto" | "flagged" | "confirmed";
export type CompetitionStatus =
  | "draft"
  | "open"
  | "in_progress"
  | "provisional"
  | "final"
  | "closed";

export interface Club {
  id: string;
  name: string;
  created_at: string;
}

/** Membership organizer↔club (issue 29): the organizer manages the clubs they belong to. */
export interface ClubMember {
  club_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export interface Competition {
  id: string;
  club_id: string;
  name: string;
  type: CompetitionType;
  status: CompetitionStatus;
  scoring_config: ScoringConfig;
  aggregation_config: AggregationConfig;
  created_at: string;
}

export interface Round {
  id: string;
  competition_id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: RoundStatus;
  /**
   * Group index for the standings (issue 18): rounds of the same competition with
   * the same non-null index form a group (typically two-by-two). `null` = ungrouped.
   */
  group_index: number | null;
  /** Issue 10: this round receives inbound WhatsApp scorecard photos. */
  whatsapp_active: boolean;
  created_at: string;
}

/** A competition's angler (issue 30): the roster lives inside each competition. */
export interface Angler {
  id: string;
  competition_id: string;
  name: string;
  license_number: string;
  federation_number: string | null;
  phone: string | null;
  created_at: string;
}

export interface Pair {
  id: string;
  competition_id: string;
  name: string | null;
  angler1_id: string;
  angler2_id: string;
}

/**
 * A sector: a competition-level reusable label (issue 41). The name may be a single
 * stretch ("A") or a composite the pair self-organizes within ("17/18/19").
 */
export interface Sector {
  id: string;
  competition_id: string;
  name: string;
}

/**
 * A lot (issue 20/42): the number drawn in the sorteo, scoped to a competition. Its
 * per-round pattern (fish/control + sector) lives in `round_entry`. The draw assigns
 * it to an angler (individual) or a pair (pairs, one lot per pair, issue 43); both
 * are null until the draw.
 */
export interface Lot {
  id: string;
  competition_id: string;
  number: number;
  angler_id: string | null;
  pair_id: string | null;
}

/** A lot's per-round role: it fishes a sector or controls a sector (issue 42). */
export type RoundRole = "fish" | "control";

/**
 * The lot's per-round pattern (issue 42): for each round, the role it plays and the
 * sector it fishes/controls. Both roles carry a sector now.
 */
export interface RoundEntry {
  id: string;
  competition_id: string;
  round_id: string;
  lot_id: string;
  role: RoundRole;
  sector_id: string;
}

export interface Scorecard {
  id: string;
  competition_id: string;
  round_id: string;
  entry_id: string;
  /**
   * The member who turned in this plica (issue 42/43). In an individual competition
   * it equals the lot's drawn angler; in pairs it is the specific member, so the two
   * members' results sum (FEPyC). Null when not yet attributed.
   */
  angler_id: string | null;
  status: ScorecardStatus;
  total_legal_catches: number | null;
  total_undersized: number | null;
  biggest_catch_cm: number | null;
  catch_points: number;
  issues: ValidationIssue[];
  created_at: string;
  updated_at: string;
}

export interface CatchRow {
  id: string;
  competition_id: string;
  scorecard_id: string;
  size_cm: number;
  undersized: boolean;
  seq: number;
}

export interface ScorecardPhoto {
  id: string;
  competition_id: string;
  scorecard_id: string;
  storage_path: string;
  created_at: string;
}

export type ClaimStatus = "open" | "resolved" | "rejected";

/** A claim against a scorecard (issue 25): scorecard_id is mandatory. */
export interface Claim {
  id: string;
  competition_id: string;
  round_id: string;
  scorecard_id: string;
  author: string;
  reason: string;
  status: ClaimStatus;
  resolution: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}
