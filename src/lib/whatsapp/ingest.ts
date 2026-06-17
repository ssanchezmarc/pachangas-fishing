/**
 * Issue 10 — Ingestion of an inbound WhatsApp scorecard photo into a draft plica.
 *
 * Runs in the Inngest queue (no user session) via the service-role client, which
 * bypasses RLS; the DB triggers still fill `competition_id` from the parent round.
 * The target round is the one the organizer marked "active" (whatsapp_active); the
 * lot read by the AI is matched against that round's roster to find the entry.
 *
 * The pure pieces (lot normalization, roster matching) are exported for testing;
 * the validation + scoring reuse the already-tested domain engine.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { scoreScorecard } from "@/domain/scoring";
import { validateScorecard } from "@/domain/validation";
import type { Catch, ScoringConfig } from "@/domain/types";
import { ALTO_CARRION_PRESET } from "@/domain/types";
import type { ParsedScorecardReading } from "@/domain/reading-schema";
import type { ValidationIssue } from "@/domain/validation";

/** Outcome of ingesting one photo (drives the quality loop, issue 11). */
export type IngestOutcome =
  | { kind: "no_active_round" }
  | { kind: "round_final" }
  | { kind: "lot_not_in_roster"; lot: string; roundId: string }
  | { kind: "already_settled"; scorecardId: string }
  | {
      kind: "stored";
      scorecardId: string;
      status: "auto" | "flagged";
      issues: ValidationIssue[];
      lot: string;
      /** True when this is a resend that updated an existing plica. */
      resend: boolean;
    };

/** Normalizes a read lot to compare against roster lot numbers ("17", " 17 " → "17"). */
export function normalizeLot(lot: string): string {
  return String(lot).trim().replace(/^0+(?=\d)/, "");
}

interface ActiveRound {
  id: string;
  status: string;
  config: ScoringConfig;
  /** lot number (normalized) → round_entry id. */
  entryByLot: Map<string, string>;
  /** sector id of each entry, for the scorecard's sector. */
  rosterLots: Set<string>;
}

/** Loads the round currently receiving WhatsApp photos (most recent if several). */
export async function loadActiveRound(): Promise<ActiveRound | null> {
  const supabase = createSupabaseServiceClient();
  const { data: round } = await supabase
    .from("round")
    .select("id, status, competition(scoring_config)")
    .eq("whatsapp_active", true)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!round) return null;

  const rel = (round as { competition: unknown }).competition;
  const comp = Array.isArray(rel) ? rel[0] : rel;
  const config =
    (comp as { scoring_config?: ScoringConfig } | null)?.scoring_config ?? ALTO_CARRION_PRESET;

  const { data: entries } = await supabase
    .from("round_entry")
    // round_entry has two FKs to lot (lot_id + controls_lot_id since 0016), so the
    // embed must name the relationship to avoid PostgREST's ambiguity error.
    .select("id, lot:lot!round_entry_lot_id_fkey(number)")
    .eq("round_id", round.id);

  const entryByLot = new Map<string, string>();
  const rosterLots = new Set<string>();
  for (const e of entries ?? []) {
    const lot = Array.isArray(e.lot) ? e.lot[0] : e.lot;
    if (lot) {
      const n = normalizeLot(String(lot.number));
      entryByLot.set(n, e.id);
      rosterLots.add(n);
    }
  }
  return { id: round.id, status: round.status, config, entryByLot, rosterLots };
}

/**
 * Ingests a parsed reading into the active round: matches the lot to an entry,
 * validates (checksum + confidence, issue 08) and stores the scorecard as
 * auto/flagged with its catches. Returns an outcome the quality loop reacts to.
 */
export async function ingestReading(reading: ParsedScorecardReading): Promise<IngestOutcome> {
  const round = await loadActiveRound();
  if (!round) return { kind: "no_active_round" };
  if (round.status === "final") return { kind: "round_final" };

  const lot = normalizeLot(reading.lot);
  const entryId = round.entryByLot.get(lot);
  if (!entryId) return { kind: "lot_not_in_roster", lot, roundId: round.id };

  const result = validateScorecard(reading, { config: round.config, rosterLots: round.rosterLots });
  const catches: Catch[] = reading.catches.map((c) => ({ sizeCm: c.handwrittenSize }));
  const r = scoreScorecard(catches, round.config);

  const supabase = createSupabaseServiceClient();

  // A resend lands on the same (round, entry): update the existing plica instead of
  // duplicating (issue 11). A plica already confirmed by the committee is settled.
  const { data: existing } = await supabase
    .from("scorecard")
    .select("id, status")
    .eq("round_id", round.id)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (existing?.status === "confirmed") {
    return { kind: "already_settled", scorecardId: existing.id };
  }

  const fields = {
    status: result.status, // 'auto' | 'flagged'
    total_legal_catches: reading.totals.legalCatches,
    total_undersized: reading.totals.undersizedCatches,
    biggest_catch_cm: reading.totals.biggestCatchCm,
    catch_points: r.catchPoints,
    issues: result.issues,
  };

  let scorecardId: string;
  if (existing) {
    const { error } = await supabase
      .from("scorecard")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    await supabase.from("catch").delete().eq("scorecard_id", existing.id);
    scorecardId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from("scorecard")
      .insert({ round_id: round.id, entry_id: entryId, ...fields })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Could not store the scorecard.");
    scorecardId = created.id;
  }

  if (catches.length > 0) {
    await supabase.from("catch").insert(
      catches.map((c, i) => ({
        scorecard_id: scorecardId,
        size_cm: c.sizeCm,
        undersized: c.sizeCm < round.config.minSizeCm,
        seq: i,
      })),
    );
  }

  return {
    kind: "stored",
    scorecardId,
    status: result.status,
    issues: result.issues,
    lot,
    resend: Boolean(existing),
  };
}
