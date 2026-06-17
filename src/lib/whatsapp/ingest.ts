/**
 * Issue 10 — Ingestion of an inbound WhatsApp scorecard photo into a draft plica.
 *
 * Runs in the Inngest queue (no user session) via the service-role client, which
 * bypasses RLS; the DB triggers still fill `competition_id` from the parent round.
 * The target round is the one the organizer marked "active" (whatsapp_active); the
 * lot read by the AI is matched against that round's roster to find the entry.
 *
 * Member attribution (issue 42): a plica is attributed to the angler who turned it
 * in. In an individual competition the lot maps to a single angler. In pairs one lot
 * is shared by both members, so we match the read angler identity (license/name)
 * against the pair's two members; if it can't be resolved, the plica is flagged for
 * the organizer to attribute manually.
 *
 * The pure pieces (lot normalization, member matching) are exported for testing;
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

/** A candidate member to attribute a plica to. */
export interface RosterMember {
  id: string;
  name: string;
  license: string;
}

/** Normalizes a read lot to compare against roster lot numbers ("17", " 17 " → "17"). */
export function normalizeLot(lot: string): string {
  return String(lot).trim().replace(/^0+(?=\d)/, "");
}

const normalize = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Resolves which member a plica belongs to among the lot's candidates (issue 42).
 * One candidate → that member. Several (a pair) → match by license, then by name.
 * Returns null when it cannot be resolved unambiguously.
 */
export function resolveMember(
  members: RosterMember[],
  reading: { anglerName?: string; license?: string },
): RosterMember | null {
  if (members.length === 1) return members[0];
  if (members.length === 0) return null;

  if (reading.license) {
    const lic = normalize(reading.license);
    const byLicense = members.filter((m) => normalize(m.license) === lic);
    if (byLicense.length === 1) return byLicense[0];
  }
  if (reading.anglerName) {
    const name = normalize(reading.anglerName);
    const byName = members.filter((m) => {
      const n = normalize(m.name);
      return n === name || n.includes(name) || name.includes(n);
    });
    if (byName.length === 1) return byName[0];
  }
  return null;
}

interface ActiveRound {
  id: string;
  status: string;
  config: ScoringConfig;
  /** lot number (normalized) → its entry id + candidate members to attribute. */
  byLot: Map<string, { entryId: string; members: RosterMember[] }>;
  rosterLots: Set<string>;
}

/** Loads the round currently receiving WhatsApp photos (most recent if several). */
export async function loadActiveRound(): Promise<ActiveRound | null> {
  const supabase = createSupabaseServiceClient();
  const { data: round } = await supabase
    .from("round")
    .select("id, status, competition_id, competition(scoring_config)")
    .eq("whatsapp_active", true)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!round) return null;

  const rel = (round as { competition: unknown }).competition;
  const comp = Array.isArray(rel) ? rel[0] : rel;
  const config =
    (comp as { scoring_config?: ScoringConfig } | null)?.scoring_config ?? ALTO_CARRION_PRESET;
  const competitionId = (round as { competition_id: string }).competition_id;

  // The roster: each entry's lot, with whom it is drawn to (an angler or a pair).
  const { data: entries } = await supabase
    .from("round_entry")
    .select("id, lot(number, angler_id, pair_id)")
    .eq("round_id", round.id);

  // Members of the competition (to attribute), and the pairs (member pairs).
  const [{ data: anglers }, { data: pairs }] = await Promise.all([
    supabase.from("angler").select("id, name, license_number").eq("competition_id", competitionId),
    supabase.from("pair").select("id, angler1_id, angler2_id").eq("competition_id", competitionId),
  ]);

  const memberById = new Map<string, RosterMember>(
    (anglers ?? []).map((a: { id: string; name: string; license_number: string }) => [
      a.id,
      { id: a.id, name: a.name, license: a.license_number },
    ]),
  );
  const pairById = new Map(
    (pairs ?? []).map((p: { id: string; angler1_id: string; angler2_id: string }) => [p.id, p]),
  );

  const byLot = new Map<string, { entryId: string; members: RosterMember[] }>();
  const rosterLots = new Set<string>();
  for (const e of entries ?? []) {
    const lot = (Array.isArray(e.lot) ? e.lot[0] : e.lot) as
      | { number: number; angler_id: string | null; pair_id: string | null }
      | null;
    if (!lot) continue;
    const n = normalizeLot(String(lot.number));
    const members: RosterMember[] = [];
    if (lot.angler_id) {
      const m = memberById.get(lot.angler_id);
      if (m) members.push(m);
    } else if (lot.pair_id) {
      const pair = pairById.get(lot.pair_id);
      for (const id of pair ? [pair.angler1_id, pair.angler2_id] : []) {
        const m = memberById.get(id);
        if (m) members.push(m);
      }
    }
    byLot.set(n, { entryId: e.id, members });
    rosterLots.add(n);
  }
  return { id: round.id, status: round.status, config, byLot, rosterLots };
}

/**
 * Ingests a parsed reading into the active round: matches the lot to an entry,
 * attributes it to a member, validates (checksum + confidence, issue 08) and stores
 * the scorecard as auto/flagged with its catches. Returns an outcome the quality
 * loop reacts to.
 */
export async function ingestReading(reading: ParsedScorecardReading): Promise<IngestOutcome> {
  const round = await loadActiveRound();
  if (!round) return { kind: "no_active_round" };
  if (round.status === "final") return { kind: "round_final" };

  const lot = normalizeLot(reading.lot);
  const match = round.byLot.get(lot);
  if (!match) return { kind: "lot_not_in_roster", lot, roundId: round.id };
  const entryId = match.entryId;

  const member = resolveMember(match.members, reading);
  const anglerId = member?.id ?? null;

  const result = validateScorecard(reading, { config: round.config, rosterLots: round.rosterLots });
  const issues = [...result.issues];
  let status = result.status;
  // Pairs: the lot has two candidates and we couldn't tell which member this is.
  if (!anglerId && match.members.length > 1) {
    issues.push({ code: "memberUnresolved", params: { lot } });
    status = "flagged";
  }

  const catches: Catch[] = reading.catches.map((c) => ({ sizeCm: c.handwrittenSize }));
  const r = scoreScorecard(catches, round.config);

  const supabase = createSupabaseServiceClient();

  // A resend lands on the same (round, entry, member): update instead of duplicating
  // (issue 11). A plica already confirmed by the committee is settled. When the
  // member is unresolved we can't dedupe by member, so it is stored as a new plica.
  let existingQuery = supabase
    .from("scorecard")
    .select("id, status")
    .eq("round_id", round.id)
    .eq("entry_id", entryId);
  existingQuery = anglerId
    ? existingQuery.eq("angler_id", anglerId)
    : existingQuery.is("angler_id", null);
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing?.status === "confirmed") {
    return { kind: "already_settled", scorecardId: existing.id };
  }

  const fields = {
    angler_id: anglerId,
    status,
    total_legal_catches: reading.totals.legalCatches,
    total_undersized: reading.totals.undersizedCatches,
    biggest_catch_cm: reading.totals.biggestCatchCm,
    catch_points: r.catchPoints,
    issues,
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
    status,
    issues,
    lot,
    resend: Boolean(existing),
  };
}
