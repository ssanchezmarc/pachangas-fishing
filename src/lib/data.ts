/**
 * Server loaders: read from Supabase and delegate the computation to the domain.
 * Return rows already enriched with names, ready to render.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PUBLIC_COMPETITION_STATUSES, isPubliclyVisible } from "@/domain/competition-status";
import { sectorLabel } from "@/domain/sector";
import {
  buildRoundStandings,
  buildCompetitionStandings,
  buildGroupStandings,
  type ScorecardToRank,
  type CompetitionScorecardToRank,
} from "@/lib/standings";
import { groupRounds, hasGroupedRounds } from "@/domain/round-groups";
import type { Catch } from "@/domain/types";
import type {
  Angler,
  Competition,
  Pair,
  Round,
  RoundEntry,
  Sector,
} from "@/lib/supabase/types";

export interface IndividualRow {
  position: number;
  angler: string;
  sector: string;
  placingsSum: number;
  totalCatchPoints: number;
  biggestCatchCm: number;
}

export interface PairRow {
  position: number;
  pair: string;
  placingsSum: number;
  totalCatchPoints: number;
  biggestCatchCm: number;
}

export interface StandingsView {
  round: Round;
  competition: Competition;
  individual: IndividualRow[];
  pairs: PairRow[];
}

/** Standings of one round group (issue 18): its rounds aggregated together. */
export interface CompetitionGroupView {
  key: string;
  groupIndex: number | null;
  roundNames: string[];
  individual: IndividualRow[];
  pairs: PairRow[];
}

export interface CompetitionStandingsView {
  competition: Competition;
  rounds: Round[];
  individual: IndividualRow[];
  pairs: PairRow[];
  /** Per-group standings when the rounds are grouped (issue 18); empty otherwise. */
  groups: CompetitionGroupView[];
}

/**
 * A competition enriched for the public landing (issue 38): club name and the
 * date range derived from its rounds.
 */
export interface CompetitionListItem extends Competition {
  clubName: string | null;
  /** Earliest round date (ISO), or null when no round has a date. */
  dateStart: string | null;
  /** Latest round date (ISO); equals `dateStart` for a single day. */
  dateEnd: string | null;
}

/**
 * Lists competitions for the public landing (issue 15). Only publicly-visible
 * statuses are returned — draft and closed stay organizers-only (issue 28) — and
 * only public-visibility ones (issue 45): private competitions are hidden from the
 * home and reached by access code instead. Each item also carries its club name
 * and the date range of its rounds (issue 38).
 */
export async function listCompetitions(): Promise<CompetitionListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("competition")
    .select("*, club(name), round(date)")
    .in("status", PUBLIC_COMPETITION_STATUSES)
    .eq("visibility", "public")
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Row = Competition & {
    club: { name: string } | { name: string }[] | null;
    round: { date: string | null }[] | null;
  };

  return (data ?? []).map((row) => {
    const r = row as Row;
    const club = Array.isArray(r.club) ? r.club[0] : r.club;
    const dates = (r.round ?? [])
      .map((x) => x.date)
      .filter((d): d is string => Boolean(d))
      .sort();
    const { club: _club, round: _round, ...competition } = r;
    return {
      ...(competition as Competition),
      clubName: club?.name ?? null,
      dateStart: dates[0] ?? null,
      dateEnd: dates[dates.length - 1] ?? null,
    };
  });
}

/**
 * Issue 45 — Whether a competition's public pages are reachable: a public one
 * always is; a private one only with a matching access code.
 */
function visibilityAllows(
  competition: { visibility?: string | null; access_code?: string | null },
  accessCode?: string | null,
): boolean {
  if (competition.visibility !== "private") return true;
  return Boolean(accessCode) && accessCode === competition.access_code;
}

/**
 * Issue 45 — Resolves a competition id from its access code (for the /c/{code}
 * shortcut and the "type your code" form). `null` if no competition has that code.
 */
export async function resolveCompetitionByCode(code: string): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("competition")
    .select("id")
    .eq("access_code", trimmed)
    .maybeSingle();
  return data?.id ?? null;
}

/** Lists all rounds (for the public landing). */
export async function listRounds(): Promise<(Round & { competition: string })[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("round")
    .select("*, competition(name)")
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Round & { competition: { name: string } | null }) => ({
    ...r,
    competition: r.competition?.name ?? "",
  }));
}

/**
 * Loads and computes a round's standings. `null` if it does not exist, its
 * competition is not publicly visible (issue 28), or it is private and the access
 * code does not match (issue 45).
 */
export async function loadRoundStandings(
  roundId: string,
  accessCode?: string | null,
): Promise<StandingsView | null> {
  const supabase = await createSupabaseServerClient();

  const { data: round } = await supabase.from("round").select("*").eq("id", roundId).single();
  if (!round) return null;

  const { data: competition } = await supabase
    .from("competition")
    .select("*")
    .eq("id", round.competition_id)
    .single();
  // A round of a non-public competition (draft / closed) is hidden too (issue 28),
  // and a private one needs its access code (issue 45).
  if (!competition || !isPubliclyVisible(competition.status)) return null;
  if (!visibilityAllows(competition, accessCode)) return null;

  const [{ data: entries }, { data: sectors }, { data: anglers }, { data: pairs }] =
    await Promise.all([
      supabase.from("round_entry").select("*").eq("round_id", roundId),
      supabase.from("sector").select("*").eq("competition_id", round.competition_id),
      supabase.from("angler").select("*").eq("competition_id", round.competition_id),
      supabase.from("pair").select("*").eq("competition_id", round.competition_id),
    ]);

  // Confirmed/auto scorecards of the round with their catches.
  const { data: scorecards } = await supabase
    .from("scorecard")
    .select("id, entry_id, angler_id, status, catch(size_cm, undersized)")
    .eq("round_id", roundId)
    .in("status", ["auto", "confirmed"]);

  const entryById = new Map((entries ?? []).map((e: RoundEntry) => [e.id, e]));
  const sectorNameById = new Map((sectors ?? []).map((s: Sector) => [s.id, sectorLabel(s)]));
  const anglerNameById = new Map((anglers ?? []).map((a: Angler) => [a.id, a.name]));

  // The angler is the member who turned in the plica (issue 42); only fishing
  // entries score (a controller's plica, if any, is ignored).
  const scorecardsToRank: ScorecardToRank[] = (scorecards ?? [])
    .map((sc: { entry_id: string; angler_id: string | null; catch: { size_cm: number }[] }) => {
      const entry = entryById.get(sc.entry_id);
      if (!entry || entry.role !== "fish" || !sc.angler_id) return null;
      const catches: Catch[] = (sc.catch ?? []).map((c) => ({ sizeCm: Number(c.size_cm) }));
      return { anglerId: sc.angler_id, sectorId: entry.sector_id, catches };
    })
    .filter((x): x is ScorecardToRank => x !== null);

  const { individual, pairs: pairStandings } = buildRoundStandings({
    roundId,
    type: competition.type,
    config: competition.scoring_config,
    aggregation: competition.aggregation_config,
    scorecards: scorecardsToRank,
    pairs: (pairs ?? []).map((p: Pair) => ({
      pairId: p.id,
      members: [p.angler1_id, p.angler2_id] as [string, string],
    })),
  });

  // Each angler's sector (to show in the individual table), from the plica's entry.
  const sectorByAngler = new Map<string, string>();
  for (const sc of (scorecards ?? []) as { entry_id: string; angler_id: string | null }[]) {
    const entry = entryById.get(sc.entry_id);
    if (sc.angler_id && entry && entry.role === "fish") {
      sectorByAngler.set(sc.angler_id, sectorNameById.get(entry.sector_id) ?? "");
    }
  }
  const pairName = new Map(
    (pairs ?? []).map((p: Pair) => [
      p.id,
      p.name ??
        `${anglerNameById.get(p.angler1_id) ?? "?"} / ${anglerNameById.get(p.angler2_id) ?? "?"}`,
    ]),
  );

  return {
    round,
    competition,
    individual: individual.map((f) => ({
      position: f.position,
      angler: anglerNameById.get(f.anglerId) ?? f.anglerId,
      sector: sectorByAngler.get(f.anglerId) ?? "",
      placingsSum: f.placingsSum,
      totalCatchPoints: f.totalCatchPoints,
      biggestCatchCm: f.biggestCatchCm,
    })),
    pairs: pairStandings.map((f) => ({
      position: f.position,
      pair: pairName.get(f.pairId) ?? f.pairId,
      placingsSum: f.placingsSum,
      totalCatchPoints: f.totalCatchPoints,
      biggestCatchCm: f.biggestCatchCm,
    })),
  };
}

/**
 * Issue 15 — Competition standings aggregated over all its rounds, plus the list
 * of rounds. `null` if the competition does not exist.
 */
export async function loadCompetitionStandings(
  competitionId: string,
  accessCode?: string | null,
): Promise<CompetitionStandingsView | null> {
  const supabase = await createSupabaseServerClient();

  const { data: competition } = await supabase
    .from("competition")
    .select("*")
    .eq("id", competitionId)
    .single();
  // Draft / closed competitions are not public (issue 28); a private one needs its
  // access code (issue 45).
  if (!competition || !isPubliclyVisible(competition.status)) return null;
  if (!visibilityAllows(competition, accessCode)) return null;

  const { data: rounds } = await supabase
    .from("round")
    .select("*")
    .eq("competition_id", competitionId)
    .order("date");
  const roundList = (rounds ?? []) as Round[];
  const roundIds = roundList.map((r) => r.id);

  const [{ data: entries }, { data: anglers }, { data: pairs }] = await Promise.all([
    roundIds.length
      ? supabase.from("round_entry").select("*").in("round_id", roundIds)
      : Promise.resolve({ data: [] as RoundEntry[] }),
    supabase.from("angler").select("*").eq("competition_id", competitionId),
    supabase.from("pair").select("*").eq("competition_id", competitionId),
  ]);

  const { data: scorecards } = roundIds.length
    ? await supabase
        .from("scorecard")
        .select("id, entry_id, round_id, angler_id, status, catch(size_cm, undersized)")
        .in("round_id", roundIds)
        .in("status", ["auto", "confirmed"])
    : { data: [] as { id: string; entry_id: string; round_id: string; angler_id: string | null; catch: { size_cm: number }[] }[] };

  const entryById = new Map((entries ?? []).map((e: RoundEntry) => [e.id, e]));
  const anglerNameById = new Map((anglers ?? []).map((a: Angler) => [a.id, a.name]));

  const scorecardsToRank: CompetitionScorecardToRank[] = (scorecards ?? [])
    .map((sc: { entry_id: string; round_id: string; angler_id: string | null; catch: { size_cm: number }[] }) => {
      const entry = entryById.get(sc.entry_id);
      if (!entry || entry.role !== "fish" || !sc.angler_id) return null;
      const catches: Catch[] = (sc.catch ?? []).map((c) => ({ sizeCm: Number(c.size_cm) }));
      return { roundId: sc.round_id, anglerId: sc.angler_id, sectorId: entry.sector_id, catches };
    })
    .filter((x): x is CompetitionScorecardToRank => x !== null);

  const pairsInput = (pairs ?? []).map((p: Pair) => ({
    pairId: p.id,
    members: [p.angler1_id, p.angler2_id] as [string, string],
  }));

  const pairName = new Map(
    (pairs ?? []).map((p: Pair) => [
      p.id,
      p.name ??
        `${anglerNameById.get(p.angler1_id) ?? "?"} / ${anglerNameById.get(p.angler2_id) ?? "?"}`,
    ]),
  );

  // Maps an engine result into name-enriched rows (shared by overall + groups).
  const toIndividualRows = (rows: { position: number; anglerId: string; placingsSum: number; totalCatchPoints: number; biggestCatchCm: number }[]): IndividualRow[] =>
    rows.map((f) => ({
      position: f.position,
      angler: anglerNameById.get(f.anglerId) ?? f.anglerId,
      sector: "",
      placingsSum: f.placingsSum,
      totalCatchPoints: f.totalCatchPoints,
      biggestCatchCm: f.biggestCatchCm,
    }));
  const toPairRows = (rows: { position: number; pairId: string; placingsSum: number; totalCatchPoints: number; biggestCatchCm: number }[]): PairRow[] =>
    rows.map((f) => ({
      position: f.position,
      pair: pairName.get(f.pairId) ?? f.pairId,
      placingsSum: f.placingsSum,
      totalCatchPoints: f.totalCatchPoints,
      biggestCatchCm: f.biggestCatchCm,
    }));

  const overall = buildCompetitionStandings({
    type: competition.type,
    config: competition.scoring_config,
    aggregation: competition.aggregation_config,
    scorecards: scorecardsToRank,
    pairs: pairsInput,
  });

  // Issue 18 — per-group standings: aggregate each group's rounds on their own.
  // Only surfaced when the rounds are actually grouped (some share a group index).
  const roundGroups = groupRounds(
    roundList.map((r) => ({ roundId: r.id, groupIndex: r.group_index })),
  );
  const roundNameById = new Map(roundList.map((r) => [r.id, r.name]));
  const groups: CompetitionGroupView[] = hasGroupedRounds(roundGroups)
    ? roundGroups.map((g) => {
        const ids = new Set(g.roundIds);
        const gStandings = buildGroupStandings({
          type: competition.type,
          config: competition.scoring_config,
          aggregation: competition.aggregation_config,
          scorecards: scorecardsToRank.filter((s) => ids.has(s.roundId)),
          pairs: pairsInput,
        });
        return {
          key: g.key,
          groupIndex: g.groupIndex,
          roundNames: g.roundIds.map((id) => roundNameById.get(id) ?? id),
          individual: toIndividualRows(gStandings.individual),
          pairs: toPairRows(gStandings.pairs),
        };
      })
    : [];

  return {
    competition,
    rounds: roundList,
    individual: toIndividualRows(overall.individual),
    pairs: toPairRows(overall.pairs),
    groups,
  };
}
