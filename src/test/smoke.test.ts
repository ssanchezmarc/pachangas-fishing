/**
 * Issue 01 — Walking-skeleton smoke test (DB-backed).
 *
 * Covers the acceptance path "an organizer creates a competition + round → the
 * public web (no login) sees that round with an (empty) standings table". It
 * arranges fixtures with the service-role client and then reads exactly what the
 * public landing reads, through an anonymous client, so it also exercises the
 * public-read RLS policies and the API grants (migration 0017).
 *
 * Runs only against a local Supabase; skipped in CI (see `dbEnvReady`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_COMPETITION_STATUSES } from "@/domain/competition-status";
import { anonClient, createOrganizer, dbEnvReady, deleteOrganizer, serviceClient } from "./db";

describe.skipIf(!dbEnvReady)("smoke: create competition → public sees empty standings", () => {
  const svc = serviceClient();
  let userId = "";
  let clubId = "";
  let competitionId = "";
  let roundId = "";

  beforeAll(async () => {
    const organizer = await createOrganizer("smoke-organizer@pachangas.local", "smoke-pass-123");
    userId = organizer.id;

    const { data: club, error: clubErr } = await svc
      .from("club")
      .insert({ name: "Smoke Club" })
      .select("id")
      .single();
    if (clubErr || !club) throw new Error(clubErr?.message ?? "club insert failed");
    clubId = club.id;

    await svc.from("club_member").insert({ club_id: clubId, user_id: userId, role: "owner" });

    const { data: comp, error: compErr } = await svc
      .from("competition")
      .insert({ club_id: clubId, name: "Smoke Cup", status: "open", type: "individual" })
      .select("id")
      .single();
    if (compErr || !comp) throw new Error(compErr?.message ?? "competition insert failed");
    competitionId = comp.id;

    const { data: round, error: roundErr } = await svc
      .from("round")
      .insert({ competition_id: competitionId, name: "Manga 1", date: "2026-06-20" })
      .select("id")
      .single();
    if (roundErr || !round) throw new Error(roundErr?.message ?? "round insert failed");
    roundId = round.id;
  });

  afterAll(async () => {
    // Deleting the club cascades to competition → round → entries.
    if (clubId) await svc.from("club").delete().eq("id", clubId);
    if (userId) await deleteOrganizer(userId);
  });

  it("the public (anon) lists the open competition", async () => {
    const { data, error } = await anonClient()
      .from("competition")
      .select("id, name, status")
      .in("status", PUBLIC_COMPETITION_STATUSES);
    expect(error).toBeNull();
    expect(data?.some((c) => c.id === competitionId)).toBe(true);
  });

  it("the public (anon) sees the round", async () => {
    const { data, error } = await anonClient()
      .from("round")
      .select("id, name, competition(name)")
      .eq("id", roundId)
      .single();
    expect(error).toBeNull();
    expect(data?.name).toBe("Manga 1");
    const comp = data?.competition as unknown as { name: string } | { name: string }[] | null;
    const compName = Array.isArray(comp) ? comp[0]?.name : comp?.name;
    expect(compName).toBe("Smoke Cup");
  });

  it("the round's standings are empty (no scorecards yet)", async () => {
    const { data, error } = await anonClient()
      .from("scorecard")
      .select("id")
      .eq("round_id", roundId)
      .in("status", ["auto", "confirmed"]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
