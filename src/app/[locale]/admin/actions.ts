"use server";
/**
 * Organizers' server actions. Every write goes through the authenticated client
 * (RLS requires a session). v1 is single-club: the first club is resolved.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoreScorecard } from "@/domain/scoring";
import type { ScoringConfig, Catch } from "@/domain/types";
import { ALTO_CARRION_PRESET } from "@/domain/types";
import { canTransition } from "@/domain/round-status";
import { canTransitionCompetition } from "@/domain/competition-status";
import { isResolution } from "@/domain/claim";
import { expandMeasures, parseMeasureLines } from "@/domain/manual-entry";
import type { RoundStatus, CompetitionStatus } from "@/lib/supabase/types";
import { resolveReader } from "@/lib/ai/reader";
import { validateScorecard } from "@/domain/validation";

async function clubId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("club").select("id").limit(1).single();
  if (error || !data) throw new Error("No club configured.");
  return data.id;
}

export async function createCompetition(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const name = String(formData.get("name") ?? "").trim();
  // Issue 16: a competition is individual or pairs. Defaults to pairs (Liga Duos).
  const type = String(formData.get("type") ?? "pairs") === "individual" ? "individual" : "pairs";
  if (!name) throw new Error("Name required.");
  const { error } = await supabase
    .from("competition")
    .insert({ club_id: await clubId(), name, type });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function createRound(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const start_time = String(formData.get("start_time") ?? "") || null;
  const end_time = String(formData.get("end_time") ?? "") || null;
  // Issue 18: optional group index to pair this round with another for the standings.
  const groupRaw = String(formData.get("group_index") ?? "").trim();
  const group_index = groupRaw ? Number(groupRaw) : null;
  if (!competition_id || !name || !date) throw new Error("Competition, name and date required.");
  if (group_index !== null && (!Number.isInteger(group_index) || group_index <= 0)) {
    throw new Error("The group must be a positive integer.");
  }
  const { error } = await supabase
    .from("round")
    .insert({ club_id: await clubId(), competition_id, name, date, start_time, end_time, group_index });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 18 — Sets (or clears) a round's group index, grouping rounds two-by-two for
 * the standings. An empty value ungroups the round.
 */
export async function setRoundGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const competition_id = String(formData.get("competition_id") ?? "");
  const groupRaw = String(formData.get("group_index") ?? "").trim();
  const group_index = groupRaw ? Number(groupRaw) : null;
  if (!round_id) throw new Error("Round required.");
  if (group_index !== null && (!Number.isInteger(group_index) || group_index <= 0)) {
    throw new Error("The group must be a positive integer.");
  }
  const { error } = await supabase.from("round").update({ group_index }).eq("id", round_id);
  if (error) throw new Error(error.message);
  if (competition_id) revalidatePath(`/admin/competition/${competition_id}`);
  revalidatePath(`/admin/round/${round_id}`);
}

export async function createSector(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!round_id || !name) throw new Error("Round and name required.");
  const { error } = await supabase.from("sector").insert({ club_id: await clubId(), round_id, name });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/round/${round_id}`);
}

export async function createAngler(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  // Issue 19: name + license are mandatory; federation number and phone optional.
  const name = String(formData.get("name") ?? "").trim();
  const license_number = String(formData.get("license_number") ?? "").trim();
  const federation_number = String(formData.get("federation_number") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  if (!name) throw new Error("Name required.");
  if (!license_number) throw new Error("License number required.");
  const { error } = await supabase
    .from("angler")
    .insert({ club_id: await clubId(), name, license_number, federation_number, phone });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

/**
 * Issue 20: registers a lot — the number drawn in the sorteo, scoped to a
 * competition, assigned to an angler. Replaces the loose bib.
 */
export async function createLot(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const angler_id = String(formData.get("angler_id") ?? "");
  const number = Number(String(formData.get("number") ?? "").trim());
  if (!competition_id || !angler_id) throw new Error("Competition and angler required.");
  if (!Number.isInteger(number) || number <= 0) throw new Error("A positive lot number is required.");
  const { error } = await supabase
    .from("lot")
    .insert({ club_id: await clubId(), competition_id, angler_id, number });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Roster: the lot's participation in a round (which sector it fishes, which lot it
 * controls). Derived from the lot — no loose bib (issue 20).
 */
export async function addEntry(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const lot_id = String(formData.get("lot_id") ?? "");
  const sector_id = String(formData.get("sector_id") ?? "");
  const controls_lot_id = String(formData.get("controls_lot_id") ?? "") || null;
  if (!round_id || !lot_id || !sector_id) throw new Error("Round, lot and sector required.");
  const { error } = await supabase.from("round_entry").insert({
    club_id: await clubId(),
    round_id,
    lot_id,
    sector_id,
    controls_lot_id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/round/${round_id}`);
}

export async function createPair(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const angler1_id = String(formData.get("angler1_id") ?? "");
  const angler2_id = String(formData.get("angler2_id") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;
  if (!competition_id || !angler1_id || !angler2_id)
    throw new Error("Competition and two anglers required.");
  if (angler1_id === angler2_id) throw new Error("A pair is two distinct anglers.");
  const { error } = await supabase
    .from("pair")
    .insert({ club_id: await clubId(), competition_id, angler1_id, angler2_id, name });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Slice 03 — Manual entry of a scorecard with its catches. The rules engine
 * (scoreScorecard) computes points and totals; being a manual organizers' entry,
 * the scorecard becomes 'confirmed'. Sizes come as a comma-separated list.
 */
export async function createScorecard(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const entry_id = String(formData.get("entry_id") ?? "");
  const sizesRaw = String(formData.get("sizes") ?? "");
  if (!round_id || !entry_id) throw new Error("Round and entry required.");

  // A final round is immutable (RF-11): no more scorecards accepted.
  const { data: roundStatus } = await supabase
    .from("round")
    .select("status")
    .eq("id", round_id)
    .single();
  if (roundStatus?.status === "final") throw new Error("The round is final (immutable).");

  const catches: Catch[] = sizesRaw
    .split(/[,\n]/)
    .map((t) => t.trim().replace(",", "."))
    .filter((t) => t.length > 0)
    .map((t) => ({ sizeCm: Number(t) }));
  if (catches.some((c) => Number.isNaN(c.sizeCm))) throw new Error("Some sizes are not numeric.");

  const config: ScoringConfig = await roundScoringConfig(round_id);
  const r = scoreScorecard(catches, config);
  const cid = await clubId();

  const { data: scorecard, error } = await supabase
    .from("scorecard")
    .insert({
      club_id: cid,
      round_id,
      entry_id,
      status: "confirmed",
      total_legal_catches: r.legalCatches,
      total_undersized: r.undersizedCatches,
      biggest_catch_cm: r.biggestCatchCm,
      catch_points: r.catchPoints,
    })
    .select("id")
    .single();
  if (error || !scorecard) throw new Error(error?.message ?? "Could not create the scorecard.");

  if (catches.length > 0) {
    const rows = catches.map((c, i) => ({
      club_id: cid,
      scorecard_id: scorecard.id,
      size_cm: c.sizeCm,
      undersized: c.sizeCm < config.minSizeCm,
      seq: i,
    }));
    const { error: eCatches } = await supabase.from("catch").insert(rows);
    if (eCatches) throw new Error(eCatches.message);
  }

  // Optional evidence photo → private storage + scorecard_photo row.
  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "scorecards";
    const ext = photo.name.split(".").pop() || "jpg";
    const path = `${round_id}/${scorecard.id}.${ext}`;
    const { error: eUp } = await supabase.storage.from(bucket).upload(path, photo, {
      contentType: photo.type || "image/jpeg",
      upsert: true,
    });
    if (eUp) throw new Error(`Photo: ${eUp.message}`);
    const { error: ePhoto } = await supabase
      .from("scorecard_photo")
      .insert({ club_id: cid, scorecard_id: scorecard.id, storage_path: path });
    if (ePhoto) throw new Error(ePhoto.message);
  }

  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/**
 * Issue 23 — Manual scorecard entry in the real plica format: measures
 * (size → quantity) + an undersized count, with the angler (lot) and controller
 * picked in the same form. The roster entry is created on the fly if missing, so
 * the Plicas list populates without a separate prior registration (issue 21).
 */
export async function createScorecardManual(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const lot_id = String(formData.get("lot_id") ?? "");
  const sector_id = String(formData.get("sector_id") ?? "");
  const controls_lot_id = String(formData.get("controls_lot_id") ?? "") || null;
  const measuresRaw = String(formData.get("measures") ?? "");
  const undersized = Number(String(formData.get("undersized") ?? "0").trim() || "0");
  if (!round_id || !lot_id || !sector_id) throw new Error("Round, lot and sector required.");

  // A final round is immutable (RF-11).
  const { data: roundStatus } = await supabase
    .from("round")
    .select("status")
    .eq("id", round_id)
    .single();
  if (roundStatus?.status === "final") throw new Error("The round is final (immutable).");

  const config = await roundScoringConfig(round_id);
  const catches = expandMeasures(parseMeasureLines(measuresRaw), Math.trunc(undersized), config);
  const r = scoreScorecard(catches, config);
  const cid = await clubId();

  // Find-or-create the roster entry for this lot in this round.
  const { data: existing } = await supabase
    .from("round_entry")
    .select("id")
    .eq("round_id", round_id)
    .eq("lot_id", lot_id)
    .maybeSingle();

  let entry_id = existing?.id as string | undefined;
  if (!entry_id) {
    const { data: created, error: eEntry } = await supabase
      .from("round_entry")
      .insert({ club_id: cid, round_id, lot_id, sector_id, controls_lot_id })
      .select("id")
      .single();
    if (eEntry || !created) throw new Error(eEntry?.message ?? "Could not create the entry.");
    entry_id = created.id;
  }

  const { data: scorecard, error } = await supabase
    .from("scorecard")
    .insert({
      club_id: cid,
      round_id,
      entry_id,
      status: "confirmed",
      total_legal_catches: r.legalCatches,
      total_undersized: r.undersizedCatches,
      biggest_catch_cm: r.biggestCatchCm,
      catch_points: r.catchPoints,
    })
    .select("id")
    .single();
  if (error || !scorecard) throw new Error(error?.message ?? "Could not create the scorecard.");

  if (catches.length > 0) {
    const { error: eCatches } = await supabase.from("catch").insert(
      catches.map((c, i) => ({
        club_id: cid,
        scorecard_id: scorecard.id,
        size_cm: c.sizeCm,
        undersized: c.sizeCm < config.minSizeCm,
        seq: i,
      })),
    );
    if (eCatches) throw new Error(eCatches.message);
  }

  await uploadScorecardPhoto(formData, round_id, scorecard.id, cid);

  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/** Shared optional evidence-photo upload (private storage + scorecard_photo row). */
async function uploadScorecardPhoto(
  formData: FormData,
  round_id: string,
  scorecard_id: string,
  cid: string,
) {
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return;
  const supabase = await createSupabaseServerClient();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "scorecards";
  const ext = photo.name.split(".").pop() || "jpg";
  const path = `${round_id}/${scorecard_id}.${ext}`;
  const { error: eUp } = await supabase.storage.from(bucket).upload(path, photo, {
    contentType: photo.type || "image/jpeg",
    upsert: true,
  });
  if (eUp) throw new Error(`Photo: ${eUp.message}`);
  const { error: ePhoto } = await supabase
    .from("scorecard_photo")
    .insert({ club_id: cid, scorecard_id, storage_path: path });
  if (ePhoto) throw new Error(ePhoto.message);
}

async function roundScoringConfig(round_id: string): Promise<ScoringConfig> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("round")
    .select("competition(scoring_config)")
    .eq("id", round_id)
    .single();
  const rel = data?.competition as unknown;
  const comp = Array.isArray(rel) ? rel[0] : rel;
  return (comp as { scoring_config?: ScoringConfig } | null)?.scoring_config ?? ALTO_CARRION_PRESET;
}

// --- Slice 12: states, claims and audit ---

async function currentAuthor(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? "organizers";
}

async function recordAudit(entry: {
  round_id: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const supabase = await createSupabaseServerClient();
  await supabase.from("audit_log").insert({
    club_id: await clubId(),
    round_id: entry.round_id,
    entity: entry.entity,
    entity_id: entry.entity_id,
    action: entry.action,
    author: await currentAuthor(),
    details: entry.details ?? {},
  });
}

/** Round state transition (open→provisional→final), audited. */
export async function transitionRound(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const to = String(formData.get("to") ?? "") as RoundStatus;
  if (!round_id || !to) throw new Error("Round and target required.");

  const { data: round } = await supabase.from("round").select("status").eq("id", round_id).single();
  if (!round) throw new Error("Round not found.");
  if (!canTransition(round.status as RoundStatus, to)) {
    throw new Error(`Transition not allowed: ${round.status} → ${to}.`);
  }

  const { error } = await supabase.from("round").update({ status: to }).eq("id", round_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id,
    entity: "round",
    entity_id: round_id,
    action: "status_transition",
    details: { from: round.status, to },
  });
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/**
 * Issue 28 — Competition lifecycle transition. Free in any direction for now;
 * each change is audited.
 */
export async function transitionCompetition(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const to = String(formData.get("to") ?? "") as CompetitionStatus;
  if (!competition_id || !to) throw new Error("Competition and target required.");

  const { data: competition } = await supabase
    .from("competition")
    .select("status")
    .eq("id", competition_id)
    .single();
  if (!competition) throw new Error("Competition not found.");
  if (!canTransitionCompetition(competition.status as CompetitionStatus, to)) {
    throw new Error(`Transition not allowed: ${competition.status} → ${to}.`);
  }

  const { error } = await supabase
    .from("competition")
    .update({ status: to })
    .eq("id", competition_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id: null,
    entity: "competition",
    entity_id: competition_id,
    action: "status_transition",
    details: { from: competition.status, to },
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/competition/${competition_id}`);
  revalidatePath("/");
}

/**
 * Issue 25 — Registers a claim against a specific scorecard. The claim hangs off
 * the scorecard (scorecard_id mandatory); the round is derived from it.
 */
export async function registerScorecardClaim(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const scorecard_id = String(formData.get("scorecard_id") ?? "");
  const author = String(formData.get("author") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!scorecard_id || !author || !reason) throw new Error("Scorecard, author and reason required.");

  const { data: scorecard } = await supabase
    .from("scorecard")
    .select("round_id")
    .eq("id", scorecard_id)
    .single();
  if (!scorecard) throw new Error("Scorecard not found.");
  const round_id = scorecard.round_id as string;

  const { data: claim, error } = await supabase
    .from("claim")
    .insert({ club_id: await clubId(), round_id, scorecard_id, author, reason })
    .select("id")
    .single();
  if (error || !claim) throw new Error(error?.message ?? "Could not register.");

  await recordAudit({
    round_id,
    entity: "claim",
    entity_id: claim.id,
    action: "claim_created",
    details: { author, reason, scorecard_id },
  });
  revalidatePath(`/admin/scorecard/${scorecard_id}`);
  revalidatePath(`/admin/round/${round_id}`);
}

/** Resolves or rejects a claim, audited. */
export async function resolveClaim(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const claim_id = String(formData.get("claim_id") ?? "");
  const round_id = String(formData.get("round_id") ?? "");
  const scorecard_id = String(formData.get("scorecard_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (!claim_id || !isResolution(status)) throw new Error("Valid claim and status required.");

  const { error } = await supabase
    .from("claim")
    .update({ status, resolution, resolved_by: await currentAuthor(), resolved_at: new Date().toISOString() })
    .eq("id", claim_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id: round_id || null,
    entity: "claim",
    entity_id: claim_id,
    action: "claim_resolution",
    details: { status, resolution },
  });
  if (round_id) revalidatePath(`/admin/round/${round_id}`);
  if (scorecard_id) revalidatePath(`/admin/scorecard/${scorecard_id}`);
}

// --- Slices 07-09: AI reading (mock), validation and HITL queue ---

/**
 * Processes the AI reading of a scorecard (with the mock reader, slice 07),
 * validates it by checksum (slice 08) and stores it with 'auto' or 'flagged'
 * status. No real LLM: lets the F1 flow be exercised end-to-end and feeds the
 * HITL queue.
 */
export async function processScorecardReading(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const entry_id = String(formData.get("entry_id") ?? "");
  if (!round_id || !entry_id) throw new Error("Round and entry required.");

  const reading = await resolveReader().read({ image: new Uint8Array(), mimeType: "image/jpeg" });

  // Valid identifiers of the round roster are the lot numbers (issue 20): the
  // round_entry → lot join gives the lots fishing this round.
  const { data: entries } = await supabase
    .from("round_entry")
    .select("lot(number)")
    .eq("round_id", round_id);
  const rosterLots = new Set(
    (entries ?? [])
      .map((e: { lot: { number: number } | { number: number }[] | null }) => {
        const lot = Array.isArray(e.lot) ? e.lot[0] : e.lot;
        return lot ? String(lot.number) : null;
      })
      .filter((n): n is string => n !== null),
  );

  const config = await roundScoringConfig(round_id);
  const result = validateScorecard(reading, { config, rosterLots });

  const catches: Catch[] = reading.catches.map((c) => ({ sizeCm: c.handwrittenSize }));
  const r = scoreScorecard(catches, config);
  const cid = await clubId();

  const { data: scorecard, error } = await supabase
    .from("scorecard")
    .insert({
      club_id: cid,
      round_id,
      entry_id,
      status: result.status, // 'auto' | 'flagged'
      total_legal_catches: reading.totals.legalCatches,
      total_undersized: reading.totals.undersizedCatches,
      biggest_catch_cm: reading.totals.biggestCatchCm,
      catch_points: r.catchPoints,
      issues: result.issues,
    })
    .select("id")
    .single();
  if (error || !scorecard) throw new Error(error?.message ?? "Could not create the scorecard.");

  if (catches.length > 0) {
    await supabase.from("catch").insert(
      catches.map((c, i) => ({
        club_id: cid,
        scorecard_id: scorecard.id,
        size_cm: c.sizeCm,
        undersized: c.sizeCm < config.minSizeCm,
        seq: i,
      })),
    );
  }

  await recordAudit({
    round_id,
    entity: "scorecard",
    entity_id: scorecard.id,
    action: "ai_reading",
    details: { status: result.status, issues: result.issues, reading },
  });
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/** HITL queue: the organizers confirm a flagged scorecard as-is (no changes). */
export async function confirmScorecard(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const scorecard_id = String(formData.get("scorecard_id") ?? "");
  const round_id = String(formData.get("round_id") ?? "");
  if (!scorecard_id) throw new Error("Scorecard required.");

  const { error } = await supabase
    .from("scorecard")
    .update({ status: "confirmed", issues: [], updated_at: new Date().toISOString() })
    .eq("id", scorecard_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id: round_id || null,
    entity: "scorecard",
    entity_id: scorecard_id,
    action: "hitl_confirmation",
  });
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/**
 * HITL queue: the organizers correct a scorecard's sizes. Recomputes with the
 * engine and records original→corrected in the audit log (dataset to specialise
 * the model).
 */
export async function correctScorecard(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const scorecard_id = String(formData.get("scorecard_id") ?? "");
  const round_id = String(formData.get("round_id") ?? "");
  const sizesRaw = String(formData.get("sizes") ?? "");
  if (!scorecard_id || !round_id) throw new Error("Scorecard and round required.");

  const config = await roundScoringConfig(round_id);
  const newCatches: Catch[] = sizesRaw
    .split(/[,\n]/)
    .map((t) => t.trim().replace(",", "."))
    .filter((t) => t.length > 0)
    .map((t) => ({ sizeCm: Number(t) }));
  if (newCatches.some((c) => Number.isNaN(c.sizeCm))) throw new Error("Non-numeric sizes.");

  const { data: previous } = await supabase
    .from("catch")
    .select("size_cm")
    .eq("scorecard_id", scorecard_id)
    .order("seq");
  const previousSizes = (previous ?? []).map((c: { size_cm: number }) => Number(c.size_cm));

  const r = scoreScorecard(newCatches, config);
  const cid = await clubId();

  await supabase.from("catch").delete().eq("scorecard_id", scorecard_id);
  if (newCatches.length > 0) {
    await supabase.from("catch").insert(
      newCatches.map((c, i) => ({
        club_id: cid,
        scorecard_id,
        size_cm: c.sizeCm,
        undersized: c.sizeCm < config.minSizeCm,
        seq: i,
      })),
    );
  }
  const { error } = await supabase
    .from("scorecard")
    .update({
      status: "confirmed",
      issues: [],
      total_legal_catches: r.legalCatches,
      total_undersized: r.undersizedCatches,
      biggest_catch_cm: r.biggestCatchCm,
      catch_points: r.catchPoints,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scorecard_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id,
    entity: "scorecard",
    entity_id: scorecard_id,
    action: "hitl_correction",
    details: {
      original_sizes: previousSizes,
      corrected_sizes: newCatches.map((c) => c.sizeCm),
    },
  });
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/**
 * Issue 22 — Edit any scorecard from its detail page (not just flagged ones).
 * Recomputes with the engine, records original→corrected in the audit log, and
 * respects immutability: a final round admits no edits (RF-11). A flagged
 * scorecard becomes confirmed once corrected.
 */
export async function editScorecard(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const scorecard_id = String(formData.get("scorecard_id") ?? "");
  const round_id = String(formData.get("round_id") ?? "");
  const sizesRaw = String(formData.get("sizes") ?? "");
  if (!scorecard_id || !round_id) throw new Error("Scorecard and round required.");

  // Immutability: a final round cannot be edited.
  const { data: round } = await supabase.from("round").select("status").eq("id", round_id).single();
  if (round?.status === "final") throw new Error("The round is final (immutable).");

  const config = await roundScoringConfig(round_id);
  const newCatches: Catch[] = sizesRaw
    .split(/[,\n]/)
    .map((t) => t.trim().replace(",", "."))
    .filter((t) => t.length > 0)
    .map((t) => ({ sizeCm: Number(t) }));
  if (newCatches.some((c) => Number.isNaN(c.sizeCm))) throw new Error("Non-numeric sizes.");

  const { data: scorecard } = await supabase
    .from("scorecard")
    .select("status")
    .eq("id", scorecard_id)
    .single();

  const { data: previous } = await supabase
    .from("catch")
    .select("size_cm")
    .eq("scorecard_id", scorecard_id)
    .order("seq");
  const previousSizes = (previous ?? []).map((c: { size_cm: number }) => Number(c.size_cm));

  const r = scoreScorecard(newCatches, config);
  const cid = await clubId();

  await supabase.from("catch").delete().eq("scorecard_id", scorecard_id);
  if (newCatches.length > 0) {
    await supabase.from("catch").insert(
      newCatches.map((c, i) => ({
        club_id: cid,
        scorecard_id,
        size_cm: c.sizeCm,
        undersized: c.sizeCm < config.minSizeCm,
        seq: i,
      })),
    );
  }

  // A flagged scorecard is resolved by the correction; otherwise keep its status.
  const nextStatus = scorecard?.status === "flagged" ? "confirmed" : scorecard?.status;
  const { error } = await supabase
    .from("scorecard")
    .update({
      status: nextStatus,
      issues: [],
      total_legal_catches: r.legalCatches,
      total_undersized: r.undersizedCatches,
      biggest_catch_cm: r.biggestCatchCm,
      catch_points: r.catchPoints,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scorecard_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id,
    entity: "scorecard",
    entity_id: scorecard_id,
    action: "scorecard_edit",
    details: {
      original_sizes: previousSizes,
      corrected_sizes: newCatches.map((c) => c.sizeCm),
    },
  });
  revalidatePath(`/admin/scorecard/${scorecard_id}`);
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/admin");
}
