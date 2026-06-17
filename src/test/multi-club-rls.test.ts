/**
 * Issue 29 — Multi-club RLS isolation (DB-backed).
 *
 * Reads are public by design (the web filters by status); the tenant boundary is
 * on WRITES, gated by `club_member` via `is_club_member` / `is_competition_mine`.
 * This suite signs in two organizers in two different clubs and asserts that:
 *   - each can write in their own club,
 *   - neither can write in the other's club (insert blocked, cross-club update
 *     touches zero rows, child rows of a foreign competition are blocked),
 *   - an anonymous client cannot write at all.
 *
 * Runs only against a local Supabase; skipped in CI (see `dbEnvReady`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createOrganizer,
  dbEnvReady,
  deleteOrganizer,
  serviceClient,
  userClient,
} from "./db";

describe.skipIf(!dbEnvReady)("multi-club RLS: write isolation", () => {
  const svc = serviceClient();
  const ctx = {
    a: { userId: "", token: "", clubId: "", compId: "" },
    b: { userId: "", token: "", clubId: "", compId: "" },
  };

  async function setupClub(name: string, email: string) {
    const org = await createOrganizer(email, "rls-pass-123");
    const { data: club } = await svc.from("club").insert({ name }).select("id").single();
    if (!club) throw new Error(`club ${name} insert failed`);
    await svc.from("club_member").insert({ club_id: club.id, user_id: org.id, role: "owner" });
    const { data: comp } = await svc
      .from("competition")
      .insert({ club_id: club.id, name: `${name} Cup`, status: "open", type: "individual" })
      .select("id")
      .single();
    if (!comp) throw new Error(`competition ${name} insert failed`);
    return { userId: org.id, token: org.accessToken, clubId: club.id, compId: comp.id };
  }

  beforeAll(async () => {
    ctx.a = await setupClub("RLS Club A", "rls-a@pachangas.local");
    ctx.b = await setupClub("RLS Club B", "rls-b@pachangas.local");
  });

  afterAll(async () => {
    if (ctx.a.clubId) await svc.from("club").delete().eq("id", ctx.a.clubId);
    if (ctx.b.clubId) await svc.from("club").delete().eq("id", ctx.b.clubId);
    if (ctx.a.userId) await deleteOrganizer(ctx.a.userId);
    if (ctx.b.userId) await deleteOrganizer(ctx.b.userId);
  });

  it("organizer A can create a competition in their own club", async () => {
    const { data, error } = await userClient(ctx.a.token)
      .from("competition")
      .insert({ club_id: ctx.a.clubId, name: "A owns this", status: "draft", type: "individual" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) await svc.from("competition").delete().eq("id", data.id);
  });

  it("organizer A CANNOT create a competition in club B", async () => {
    const { data, error } = await userClient(ctx.a.token)
      .from("competition")
      .insert({ club_id: ctx.b.clubId, name: "A trespasses", status: "draft", type: "individual" })
      .select("id")
      .single();
    // RLS WITH CHECK rejects the insert.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("organizer A CANNOT rename club B's competition (zero rows affected)", async () => {
    const { data } = await userClient(ctx.a.token)
      .from("competition")
      .update({ name: "hijacked by A" })
      .eq("id", ctx.b.compId)
      .select("id");
    // RLS USING hides B's row from A's UPDATE → nothing is updated.
    expect(data ?? []).toEqual([]);
    const { data: fresh } = await svc
      .from("competition")
      .select("name")
      .eq("id", ctx.b.compId)
      .single();
    expect(fresh?.name).toBe("RLS Club B Cup");
  });

  it("organizer A CANNOT add a round to club B's competition", async () => {
    const { error } = await userClient(ctx.a.token)
      .from("round")
      .insert({ competition_id: ctx.b.compId, name: "A's intruding round", date: "2026-06-20" })
      .select("id")
      .single();
    expect(error).not.toBeNull();
  });

  it("organizer A CAN add a round to their own competition", async () => {
    const { data, error } = await userClient(ctx.a.token)
      .from("round")
      .insert({ competition_id: ctx.a.compId, name: "A's round", date: "2026-06-20" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) await svc.from("round").delete().eq("id", data.id);
  });

  it("an anonymous client cannot create a competition", async () => {
    const { data, error } = await anonClient()
      .from("competition")
      .insert({ club_id: ctx.a.clubId, name: "anon", status: "draft", type: "individual" })
      .select("id")
      .single();
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
