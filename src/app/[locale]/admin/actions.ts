"use server";
/**
 * Organizers' server actions. Every write goes through the authenticated client
 * (RLS requires a session). Multi-club (issue 29): a competition hangs off a club
 * the organizer belongs to; everything below the competition derives its
 * `competition_id` from the parent via DB triggers, so actions never set a tenant
 * id by hand. RLS (is_competition_mine / is_club_member) is the real guard.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { scoreScorecard } from "@/domain/scoring";
import type { ScoringConfig, Catch } from "@/domain/types";
import { ALTO_CARRION_PRESET } from "@/domain/types";
import { canTransition, allowsEditing } from "@/domain/round-status";
import { canTransitionCompetition } from "@/domain/competition-status";
import { phaseIndex } from "@/domain/phases";
import { isResolution } from "@/domain/claim";
import { expandMeasures, parseMeasureLines } from "@/domain/manual-entry";
import type { RoundStatus, CompetitionStatus } from "@/lib/supabase/types";
import { resolveReader } from "@/lib/ai/reader";
import { validateScorecard } from "@/domain/validation";
import { isPublishTransition, pushStandingsSummary } from "@/lib/whatsapp/summary";

async function currentUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return user.id;
}

/** Parses a free-text list of emails (comma/space/semicolon/newline separated). */
function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  );
}

/** Random short access code for a private competition (issue 45). */
function generateAccessCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Issue 29/47 — Creates a club, enrolls the current organizer as its owner
 * (club_member), and optionally adds more organizers by email in the same step
 * (issue 47): existing accounts are linked, unknown ones are invited. The
 * membership is what every RLS policy checks afterwards. A failing email does not
 * roll back the club; the failures are reported back.
 */
export async function createClub(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name required.");

  const { data: club, error } = await supabase
    .from("club")
    .insert({ name })
    .select("id")
    .single();
  if (error || !club) throw new Error(error?.message ?? "Could not create the club.");

  const { error: eMember } = await supabase
    .from("club_member")
    .insert({ club_id: club.id, user_id: await currentUserId(), role: "owner" });
  if (eMember) throw new Error(eMember.message);

  // Issue 47 — optional organizer emails added at creation time.
  const emails = parseEmails(String(formData.get("emails") ?? ""));
  const failed: string[] = [];
  if (emails.length) {
    const origin = await requestOrigin();
    for (const email of emails) {
      try {
        await addOrganizerToClub(club.id, email, origin);
      } catch {
        failed.push(email);
      }
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/club/${club.id}`);
  if (failed.length) throw new Error(`Club creado. No se pudieron añadir: ${failed.join(", ")}`);
}

/**
 * Issue 48 — Renames a club. The club is identified by its stable UUID, so the
 * name is free to change without affecting URLs, FKs or references.
 */
export async function updateClub(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const club_id = String(formData.get("club_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!club_id) throw new Error("Club required.");
  if (!name) throw new Error("Name required.");
  await assertClubMember(club_id);
  const { error } = await supabase.from("club").update({ name }).eq("id", club_id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath(`/admin/club/${club_id}`);
  revalidatePath("/");
}

/** Throws unless the current user is a member of `clubId`. Returns their user id. */
async function assertClubMember(clubId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  const { data } = await supabase
    .from("club_member")
    .select("club_id")
    .eq("club_id", clubId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("Not a member of this club.");
  return user.id;
}

/** Finds an auth user by email via the service role. `null` if none. */
async function findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const svc = createSupabaseServiceClient();
  const target = email.toLowerCase();
  // The admin API has no email filter; page through (small organizer base).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return { id: hit.id, email: hit.email ?? email };
    if (data.users.length < 200) break; // last page
  }
  return null;
}

/** An organizer of a club, enriched with their email (issue 37). */
export interface ClubOrganizer {
  user_id: string;
  role: string;
  email: string;
}

/**
 * Issue 37 — Lists the organizers of a club (member-readable via RLS), enriched with
 * their email through the service role (emails live in auth.users).
 */
export async function listClubOrganizers(clubId: string): Promise<ClubOrganizer[]> {
  const supabase = await createSupabaseServerClient();
  const { data: members, error } = await supabase
    .from("club_member")
    .select("user_id, role")
    .eq("club_id", clubId)
    .order("created_at");
  if (error) throw new Error(error.message);
  const svc = createSupabaseServiceClient();
  const out: ClubOrganizer[] = [];
  for (const m of members ?? []) {
    const { data } = await svc.auth.admin.getUserById(m.user_id);
    out.push({ user_id: m.user_id, role: m.role, email: data?.user?.email ?? "?" });
  }
  return out;
}

/** Absolute origin of the current request (for invite redirect URLs). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Issue 36/37 — Links or invites an organizer email to a club via the service role.
 * If the email already has an account it is linked (a club_member row); otherwise
 * an invitation email is sent (Supabase inviteUserByEmail), which creates the
 * pending account and lets them set a password on first access (see
 * /api/auth/confirm + /admin/accept). The caller must have verified its own
 * membership (or just created the club).
 */
async function addOrganizerToClub(club_id: string, email: string, origin: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Email required.");
  const svc = createSupabaseServiceClient();
  let userId: string;
  const existing = await findUserByEmail(normalized);
  if (existing) {
    userId = existing.id;
  } else {
    const redirectTo = `${origin}/api/auth/confirm?next=/admin/accept`;
    const { data, error } = await svc.auth.admin.inviteUserByEmail(normalized, { redirectTo });
    if (error || !data?.user) throw new Error(error?.message ?? "Could not send the invitation.");
    userId = data.user.id;
  }
  // Link to the club (idempotent: ignore if already a member).
  const { error: eMember } = await svc
    .from("club_member")
    .upsert({ club_id, user_id: userId, role: "owner" }, { onConflict: "club_id,user_id" });
  if (eMember) throw new Error(eMember.message);
}

/** Issue 36/37 — Adds an organizer to a club by email (single-email form). */
export async function inviteOrganizer(formData: FormData) {
  const club_id = String(formData.get("club_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!club_id) throw new Error("Club required.");
  if (!email) throw new Error("Email required.");
  await assertClubMember(club_id);
  await addOrganizerToClub(club_id, email, await requestOrigin());
  revalidatePath(`/admin/club/${club_id}`);
}

/**
 * Issue 37 — Removes an organizer from a club. Refuses to leave the club with no
 * organizers. Runs with the service role after verifying the caller's membership.
 */
export async function removeOrganizer(formData: FormData) {
  const club_id = String(formData.get("club_id") ?? "");
  const user_id = String(formData.get("user_id") ?? "");
  if (!club_id || !user_id) throw new Error("Club and organizer required.");
  await assertClubMember(club_id);

  const svc = createSupabaseServiceClient();
  const { count } = await svc
    .from("club_member")
    .select("user_id", { count: "exact", head: true })
    .eq("club_id", club_id);
  if ((count ?? 0) <= 1) throw new Error("A club must keep at least one organizer.");

  const { error } = await svc
    .from("club_member")
    .delete()
    .eq("club_id", club_id)
    .eq("user_id", user_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/club/${club_id}`);
}

/** Parses a JSON-array form field; returns [] on empty/invalid input. */
function parseJsonArray(value: FormDataEntryValue | null): unknown[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Reads a string property from a parsed JSON object, trimmed. */
function getStr(o: unknown, key: string): string {
  if (typeof o === "object" && o !== null && key in o) {
    return String((o as Record<string, unknown>)[key] ?? "").trim();
  }
  return "";
}

/**
 * Issue 29/45/49 — A competition is created inside the selected club (club_id from
 * the URL). RLS requires the organizer to be a member of that club. It also carries
 * a visibility (issue 45, public by default) and an access code generated up front,
 * and can be created with its place already set up (issue 49): sectors
 * (river/venue/name), rounds (name/date) and lots (numbers), all optional and sent
 * as JSON by the client form. Anglers/pairs are added afterwards in the view.
 */
export async function createCompetition(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const club_id = String(formData.get("club_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  // Issue 16: a competition is individual or pairs. Defaults to pairs (Liga Duos).
  const type = String(formData.get("type") ?? "pairs") === "individual" ? "individual" : "pairs";
  // Issue 45: public (listed) by default; private is code-gated.
  const visibility = String(formData.get("visibility") ?? "public") === "private" ? "private" : "public";
  if (!club_id) throw new Error("Club required.");
  if (!name) throw new Error("Name required.");

  const { data: competition, error } = await supabase
    .from("competition")
    .insert({ club_id, name, type, visibility, access_code: generateAccessCode() })
    .select("id")
    .single();
  if (error || !competition) throw new Error(error?.message ?? "Could not create the competition.");
  const competition_id = competition.id as string;

  // Issue 49 — optional place setup defined at creation.
  const sectorRows = parseJsonArray(formData.get("sectors"))
    .map((s) => ({
      competition_id,
      river: getStr(s, "river"),
      venue: getStr(s, "venue"),
      name: getStr(s, "name"),
    }))
    .filter((s) => s.name.length > 0);
  if (sectorRows.length) {
    const { error: e } = await supabase.from("sector").insert(sectorRows);
    if (e) throw new Error(e.message);
  }

  const roundRows = parseJsonArray(formData.get("rounds"))
    .map((r) => ({ competition_id, name: getStr(r, "name"), date: getStr(r, "date") || null }))
    .filter((r) => r.name.length > 0 && r.date);
  if (roundRows.length) {
    const { error: e } = await supabase.from("round").insert(roundRows);
    if (e) throw new Error(e.message);
  }

  const lotRows = parseJsonArray(formData.get("lots"))
    .map((l) => Number(l))
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((number) => ({ competition_id, number }));
  if (lotRows.length) {
    const { error: e } = await supabase.from("lot").insert(lotRows);
    if (e) throw new Error(e.message);
  }

  revalidatePath(`/admin/club/${club_id}`);
  revalidatePath("/");
}

/**
 * Issue 45 — Toggles a competition's visibility (public ↔ private). Ensures a
 * private competition always has an access code (generates one if missing).
 */
export async function toggleCompetitionVisibility(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const to = String(formData.get("to") ?? "") === "private" ? "private" : "public";
  if (!competition_id) throw new Error("Competition required.");

  const update: { visibility: string; access_code?: string } = { visibility: to };
  if (to === "private") {
    const { data } = await supabase
      .from("competition")
      .select("access_code")
      .eq("id", competition_id)
      .single();
    if (!data?.access_code) update.access_code = generateAccessCode();
  }
  const { error } = await supabase.from("competition").update(update).eq("id", competition_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
  revalidatePath("/");
}

export async function createRound(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const start_time = String(formData.get("start_time") ?? "") || null;
  const end_time = String(formData.get("end_time") ?? "") || null;
  // Issue 18/53: optional phase entered as a letter (A, B…) → 1-based group index.
  const phaseRaw = String(formData.get("phase") ?? "").trim();
  const group_index = phaseRaw ? phaseIndex(phaseRaw) : null;
  if (!competition_id || !name || !date) throw new Error("Competition, name and date required.");
  if (phaseRaw && group_index === null) throw new Error("The phase must be a letter (A, B, C…).");
  const { error } = await supabase
    .from("round")
    .insert({ competition_id, name, date, start_time, end_time, group_index });
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
  // Issue 53: phase as a letter (A, B…); empty ungroups the round.
  const phaseRaw = String(formData.get("phase") ?? "").trim();
  const group_index = phaseRaw ? phaseIndex(phaseRaw) : null;
  if (!round_id) throw new Error("Round required.");
  if (phaseRaw && group_index === null) throw new Error("The phase must be a letter (A, B, C…).");
  const { error } = await supabase.from("round").update({ group_index }).eq("id", round_id);
  if (error) throw new Error(error.message);
  if (competition_id) revalidatePath(`/admin/competition/${competition_id}`);
  revalidatePath(`/admin/round/${round_id}`);
}

/**
 * Issue 10 — Marks (or clears) the round that receives inbound WhatsApp photos.
 * Only one round per competition can be active, so activating one deactivates its
 * siblings. The ingestion queue attaches inbound plicas to the active round.
 */
export async function setRoundWhatsappActive(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const competition_id = String(formData.get("competition_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!round_id || !competition_id) throw new Error("Round and competition required.");

  if (active) {
    await supabase
      .from("round")
      .update({ whatsapp_active: false })
      .eq("competition_id", competition_id);
  }
  const { error } = await supabase
    .from("round")
    .update({ whatsapp_active: active })
    .eq("id", round_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id,
    entity: "round",
    entity_id: round_id,
    action: "whatsapp_active",
    details: { active },
  });
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 32 — Edits a round (name, date, hours, phase). Respects immutability: a
 * final round (RF-11, issue 12) cannot be edited. The change is audited and the
 * affected standings are recomputed on read, so revalidating the paths suffices.
 */
export async function updateRound(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const competition_id = String(formData.get("competition_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const start_time = String(formData.get("start_time") ?? "") || null;
  const end_time = String(formData.get("end_time") ?? "") || null;
  // Issue 53: phase as a letter (A, B…); empty ungroups the round.
  const phaseRaw = String(formData.get("phase") ?? "").trim();
  const group_index = phaseRaw ? phaseIndex(phaseRaw) : null;
  if (!round_id || !name || !date) throw new Error("Round, name and date required.");
  if (phaseRaw && group_index === null) throw new Error("The phase must be a letter (A, B, C…).");

  const { data: round } = await supabase.from("round").select("status").eq("id", round_id).single();
  if (!round) throw new Error("Round not found.");
  if (!allowsEditing(round.status as RoundStatus)) throw new Error("The round is final (immutable).");

  const { error } = await supabase
    .from("round")
    .update({ name, date, start_time, end_time, group_index })
    .eq("id", round_id);
  if (error) throw new Error(error.message);

  await recordAudit({
    round_id,
    entity: "round",
    entity_id: round_id,
    action: "round_edit",
    details: { name, date, start_time, end_time, group_index },
  });
  if (competition_id) revalidatePath(`/admin/competition/${competition_id}`);
  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/**
 * Issue 32 — Deletes a round after explicit confirmation. A final round is immutable
 * (RF-11) and cannot be deleted. The delete cascades to its sectors, entries,
 * scorecards, catches and photos via the schema FKs (on delete cascade); the audit
 * entry is written before the delete (its round_id is set null on cascade but the
 * row survives, RNF-4).
 */
export async function deleteRound(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const competition_id = String(formData.get("competition_id") ?? "");
  if (!round_id) throw new Error("Round required.");
  if (String(formData.get("confirm") ?? "") !== "on") throw new Error("Deletion must be confirmed.");

  const { data: round } = await supabase
    .from("round")
    .select("status, name")
    .eq("id", round_id)
    .single();
  if (!round) throw new Error("Round not found.");
  if (!allowsEditing(round.status as RoundStatus)) throw new Error("The round is final (immutable).");

  await recordAudit({
    round_id,
    entity: "round",
    entity_id: round_id,
    action: "round_delete",
    details: { name: round.name },
  });

  const { error } = await supabase.from("round").delete().eq("id", round_id);
  if (error) throw new Error(error.message);

  if (competition_id) {
    revalidatePath(`/admin/competition/${competition_id}`);
    revalidatePath(`/competition/${competition_id}`);
  }
  revalidatePath("/admin");
  const locale = String(formData.get("locale") ?? "es");
  if (competition_id) redirect({ href: `/admin/competition/${competition_id}`, locale });
}

/**
 * Issue 41/50 — Sectors are a competition-level reusable catalog identified by
 * river + venue (escenario/coto) + sector name. River and venue usually repeat, so
 * the UI pre-fills them; the sector name may be a single stretch ("A") or a
 * composite the pair self-organizes within ("17/18/19").
 */
export async function createSector(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const river = String(formData.get("river") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!competition_id || !name) throw new Error("Competition and sector name required.");
  const { error } = await supabase.from("sector").insert({ competition_id, river, venue, name });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/** Issue 54 — Edits a sector's three fields, from within the competition view. */
export async function updateSector(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const sector_id = String(formData.get("sector_id") ?? "");
  const river = String(formData.get("river") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!competition_id || !sector_id) throw new Error("Competition and sector required.");
  if (!name) throw new Error("Sector name required.");
  const { error } = await supabase
    .from("sector")
    .update({ river, venue, name })
    .eq("id", sector_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 54 — Deletes a sector from within the competition view, with explicit
 * confirmation. Refuses if the sector is still used by a round pattern
 * (round_entry), to avoid breaking the standings — the organizer must reassign
 * those entries first.
 */
export async function deleteSector(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const sector_id = String(formData.get("sector_id") ?? "");
  if (!competition_id || !sector_id) throw new Error("Competition and sector required.");

  const { count } = await supabase
    .from("round_entry")
    .select("id", { count: "exact", head: true })
    .eq("sector_id", sector_id);
  if ((count ?? 0) > 0) {
    throw new Error("El sector está en uso por una o más mangas; reasigna esas entradas antes de borrarlo.");
  }
  const { error } = await supabase.from("sector").delete().eq("id", sector_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 30 — Registers an angler inside a competition (the roster is per
 * competition, not per club). Issue 19: name + license mandatory.
 */
export async function createAngler(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const license_number = String(formData.get("license_number") ?? "").trim();
  const federation_number = String(formData.get("federation_number") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  if (!competition_id) throw new Error("Competition required.");
  if (!name) throw new Error("Name required.");
  if (!license_number) throw new Error("License number required.");
  const { error } = await supabase
    .from("angler")
    .insert({ competition_id, name, license_number, federation_number, phone });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 42 — Registers a lot (the number drawn in the sorteo) without an angler yet:
 * the lot's per-round pattern (fish/control + sector) is defined separately
 * (round_entry) and the draw assigns it to an angler/pair later (assignLotAngler /
 * assignLotPair). The number is unique within the competition.
 */
export async function createLot(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const number = Number(String(formData.get("number") ?? "").trim());
  if (!competition_id) throw new Error("Competition required.");
  if (!Number.isInteger(number) || number <= 0) throw new Error("A positive lot number is required.");
  const { error } = await supabase.from("lot").insert({ competition_id, number });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 43 — The draw, individual competition: assigns a defined lot to an angler.
 * An empty angler clears the assignment. Setting an angler clears any pair link.
 */
export async function assignLotAngler(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const lot_id = String(formData.get("lot_id") ?? "");
  const angler_id = String(formData.get("angler_id") ?? "") || null;
  if (!competition_id || !lot_id) throw new Error("Competition and lot required.");
  const { error } = await supabase
    .from("lot")
    .update({ angler_id, pair_id: null })
    .eq("id", lot_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 43/40 — The draw, pairs competition: assigns ONE lot to the whole pair (one
 * lot per pair). An empty pair clears the assignment. Setting a pair clears any
 * single-angler link.
 */
export async function assignLotPair(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const lot_id = String(formData.get("lot_id") ?? "");
  const pair_id = String(formData.get("pair_id") ?? "") || null;
  if (!competition_id || !lot_id) throw new Error("Competition and lot required.");
  const { error } = await supabase
    .from("lot")
    .update({ pair_id, angler_id: null })
    .eq("id", lot_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 42 — The lot's per-round PATTERN: for a round, the role it plays (fish or
 * control) and the sector (a competition-level label). Both roles carry a sector.
 * The fish/control inversion of a phase (issue 18/31) is just different roles per
 * round. Upserts so re-setting a lot's role in a round overwrites it.
 */
export async function addEntry(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const lot_id = String(formData.get("lot_id") ?? "");
  // Issue 51: the rotation matrix posts competition_id so it can revalidate itself.
  const competition_id = String(formData.get("competition_id") ?? "");
  const role = String(formData.get("role") ?? "fish") === "control" ? "control" : "fish";
  const sector_id = String(formData.get("sector_id") ?? "") || null;
  if (!round_id || !lot_id) throw new Error("Round and lot required.");
  if (!sector_id) throw new Error("An entry needs a sector.");
  const { error } = await supabase
    .from("round_entry")
    .upsert({ round_id, lot_id, role, sector_id }, { onConflict: "round_id,lot_id" });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/round/${round_id}`);
  if (competition_id) revalidatePath(`/admin/competition/${competition_id}`);
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
    .insert({ competition_id, angler1_id, angler2_id, name });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/competition/${competition_id}`);
}

/**
 * Issue 44 — Defines a full pair in a single submit. Each member is either an
 * existing roster angler (`<n>_id`) or a new one to create on the spot
 * (`<n>_name` + `<n>_license`). New anglers are inserted first, then the pair —
 * so the organizer no longer registers anglers one-by-one before forming the pair.
 */
export async function createPairFull(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;
  if (!competition_id) throw new Error("Competition required.");

  // Resolves one member: an existing angler id, or creates a new angler and returns its id.
  const resolveMember = async (prefix: string): Promise<string> => {
    const existingId = String(formData.get(`${prefix}_id`) ?? "").trim();
    if (existingId) return existingId;
    const memberName = String(formData.get(`${prefix}_name`) ?? "").trim();
    const license_number = String(formData.get(`${prefix}_license`) ?? "").trim();
    const federation_number = String(formData.get(`${prefix}_federation`) ?? "").trim() || null;
    const phone = String(formData.get(`${prefix}_phone`) ?? "").trim() || null;
    if (!memberName) throw new Error("Each angler needs a name.");
    if (!license_number) throw new Error("Each angler needs a license number.");
    const { data, error } = await supabase
      .from("angler")
      .insert({ competition_id, name: memberName, license_number, federation_number, phone })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  };

  const angler1_id = await resolveMember("angler1");
  const angler2_id = await resolveMember("angler2");
  if (angler1_id === angler2_id) throw new Error("A pair is two distinct anglers.");

  const { error } = await supabase
    .from("pair")
    .insert({ competition_id, angler1_id, angler2_id, name });
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
  const angler_id = String(formData.get("angler_id") ?? "") || null;
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

  const { data: scorecard, error } = await supabase
    .from("scorecard")
    .insert({
      round_id,
      entry_id,
      angler_id,
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
      .insert({ scorecard_id: scorecard.id, storage_path: path });
    if (ePhoto) throw new Error(ePhoto.message);
  }

  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/**
 * Issue 23/42 — Manual scorecard entry in the real plica format: measures
 * (size → quantity) + an undersized count, attached to a predefined lot pattern
 * (entry) for the round and attributed to the member who turned in the plica
 * (angler_id) — essential in pairs, where one lot is shared by both members.
 */
export async function createScorecardManual(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const round_id = String(formData.get("round_id") ?? "");
  const entry_id = String(formData.get("entry_id") ?? "");
  const angler_id = String(formData.get("angler_id") ?? "") || null;
  const measuresRaw = String(formData.get("measures") ?? "");
  const undersized = Number(String(formData.get("undersized") ?? "0").trim() || "0");
  if (!round_id || !entry_id) throw new Error("Round and entry required.");

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

  const { data: scorecard, error } = await supabase
    .from("scorecard")
    .insert({
      round_id,
      entry_id,
      angler_id,
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
        scorecard_id: scorecard.id,
        size_cm: c.sizeCm,
        undersized: c.sizeCm < config.minSizeCm,
        seq: i,
      })),
    );
    if (eCatches) throw new Error(eCatches.message);
  }

  await uploadScorecardPhoto(formData, round_id, scorecard.id);

  revalidatePath(`/admin/round/${round_id}`);
  revalidatePath(`/round/${round_id}`);
}

/** Shared optional evidence-photo upload (private storage + scorecard_photo row). */
async function uploadScorecardPhoto(formData: FormData, round_id: string, scorecard_id: string) {
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
    .insert({ scorecard_id, storage_path: path });
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
  competition_id?: string | null;
  round_id: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const supabase = await createSupabaseServerClient();
  // Tenancy column: derive the competition from the round when not given explicitly.
  let competition_id = entry.competition_id ?? null;
  if (!competition_id && entry.round_id) {
    const { data } = await supabase
      .from("round")
      .select("competition_id")
      .eq("id", entry.round_id)
      .single();
    competition_id = (data?.competition_id as string | undefined) ?? null;
  }
  await supabase.from("audit_log").insert({
    competition_id,
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

  const { data: round } = await supabase
    .from("round")
    .select("status, name")
    .eq("id", round_id)
    .single();
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

  // Issue 13 — push a summary + live link to the group when standings are published
  // (provisional and final). The push must never break the transition itself.
  if (isPublishTransition(to)) {
    await pushStandingsSummary(round_id, round.name as string, to).catch((e) =>
      console.error("WhatsApp summary push failed:", e),
    );
  }

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
    competition_id,
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
 * Issue 33 — Deletes a competition after explicit confirmation (destructive). The
 * delete cascades through the schema FKs (on delete cascade) to its rounds, sectors,
 * entries, lots, pairs, scorecards, catches, photos and claims. The audit entry is
 * written before the delete; afterwards the organizer is sent back to /admin.
 */
export async function deleteCompetition(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const competition_id = String(formData.get("competition_id") ?? "");
  if (!competition_id) throw new Error("Competition required.");
  if (String(formData.get("confirm") ?? "") !== "on") throw new Error("Deletion must be confirmed.");

  const { data: competition } = await supabase
    .from("competition")
    .select("name")
    .eq("id", competition_id)
    .single();
  if (!competition) throw new Error("Competition not found.");

  await recordAudit({
    competition_id,
    round_id: null,
    entity: "competition",
    entity_id: competition_id,
    action: "competition_delete",
    details: { name: competition.name },
  });

  const { error } = await supabase.from("competition").delete().eq("id", competition_id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/");
  const locale = String(formData.get("locale") ?? "es");
  redirect({ href: "/admin", locale });
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
    .insert({ round_id, scorecard_id, author, reason })
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
  const angler_id = String(formData.get("angler_id") ?? "") || null;
  if (!round_id || !entry_id) throw new Error("Round and entry required.");

  const reading = await resolveReader().read({ image: new Uint8Array(), mimeType: "image/jpeg" });

  // Valid identifiers of the round roster are the lot numbers (issue 20): the
  // round_entry → lot join gives the lots fishing this round.
  const { data: entries } = await supabase
    .from("round_entry")
    // Disambiguate the lot embed: round_entry has two FKs to lot since 0016.
    .select("lot:lot!round_entry_lot_id_fkey(number)")
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

  const { data: scorecard, error } = await supabase
    .from("scorecard")
    .insert({
      round_id,
      entry_id,
      angler_id,
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
  await supabase.from("catch").delete().eq("scorecard_id", scorecard_id);
  if (newCatches.length > 0) {
    await supabase.from("catch").insert(
      newCatches.map((c, i) => ({
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
  await supabase.from("catch").delete().eq("scorecard_id", scorecard_id);
  if (newCatches.length > 0) {
    await supabase.from("catch").insert(
      newCatches.map((c, i) => ({
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
