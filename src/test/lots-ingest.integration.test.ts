/**
 * Issue 42 — Local E2E of the pairs member-attribution ingest: each member's plica
 * is attributed to them (by license / name) on the shared lot, and an unresolvable
 * one is flagged. Uses the seeded example (pair "Ana & Luis", lot 17, round 7
 * fishing sector A). DB-backed: skipped in CI via `dbEnvReady`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbEnvReady, serviceClient } from "./db";
import { ingestReading } from "@/lib/whatsapp/ingest";

const ROUND = "00000000-0000-0000-0000-000000000100";
const ENTRY = "00000000-0000-0000-0000-00000000170e";
const ANA = "00000000-0000-0000-0000-00000000a001";
const LUIS = "00000000-0000-0000-0000-00000000a002";

const reading = (over: Record<string, unknown>) => ({
  lot: "17",
  catches: [{ tens: 2, units: 0, handwrittenSize: 20 }],
  totals: { legalCatches: 1, undersizedCatches: 0, biggestCatchCm: 20 },
  confidence: { lot: 0.98, catches: 0.95, totals: 0.96 },
  ...over,
});

describe.skipIf(!dbEnvReady)("pairs ingest attributes each plica to its member", () => {
  const svc = serviceClient();

  beforeAll(async () => {
    await svc.from("round").update({ whatsapp_active: true, status: "open" }).eq("id", ROUND);
    await svc.from("scorecard").delete().eq("entry_id", ENTRY);
  });
  afterAll(async () => {
    await svc.from("scorecard").delete().eq("entry_id", ENTRY);
    await svc.from("round").update({ whatsapp_active: false }).eq("id", ROUND);
  });

  it("attributes by license", async () => {
    const out = await ingestReading(reading({ license: "LIC-002" }) as never);
    expect(out.kind).toBe("stored");
    const { data } = await svc.from("scorecard").select("angler_id, status").eq("entry_id", ENTRY);
    expect(data?.length).toBe(1);
    expect(data?.[0].angler_id).toBe(LUIS);
  });

  it("attributes the second member by name, on the same entry", async () => {
    const out = await ingestReading(reading({ anglerName: "Ana Río" }) as never);
    expect(out.kind).toBe("stored");
    const { data } = await svc
      .from("scorecard")
      .select("angler_id")
      .eq("entry_id", ENTRY)
      .order("angler_id");
    expect(data?.map((d) => d.angler_id).sort()).toEqual([ANA, LUIS].sort());
  });

  it("flags when the member can't be resolved", async () => {
    await svc.from("scorecard").delete().eq("entry_id", ENTRY);
    const out = await ingestReading(reading({}) as never);
    expect(out.kind).toBe("stored");
    if (out.kind === "stored") {
      expect(out.status).toBe("flagged");
      expect(out.issues.some((i) => i.code === "memberUnresolved")).toBe(true);
    }
  });
});
