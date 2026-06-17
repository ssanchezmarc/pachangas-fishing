/**
 * Issue 42 — Member attribution for inbound plicas. `resolveMember` decides which
 * angler a plica belongs to among a lot's candidates (one in individual; the two
 * pair members in pairs). Pure logic, tested without a DB.
 */
import { describe, expect, it } from "vitest";
import { normalizeLot, resolveMember, type RosterMember } from "./ingest";

const ana: RosterMember = { id: "a1", name: "Ana Río", license: "LIC-001" };
const luis: RosterMember = { id: "a2", name: "Luis Vega", license: "LIC-002" };

describe("normalizeLot", () => {
  it("trims and strips leading zeros", () => {
    expect(normalizeLot(" 017 ")).toBe("17");
    expect(normalizeLot("17")).toBe("17");
    expect(normalizeLot("0")).toBe("0");
  });
});

describe("resolveMember", () => {
  it("individual: the single candidate is always the member", () => {
    expect(resolveMember([ana], {})?.id).toBe("a1");
  });

  it("pairs: resolves by exact license", () => {
    expect(resolveMember([ana, luis], { license: "lic-002" })?.id).toBe("a2");
  });

  it("pairs: resolves by name (accent/case-insensitive)", () => {
    expect(resolveMember([ana, luis], { anglerName: "ANA RIO" })?.id).toBe("a1");
  });

  it("pairs: license wins over an ambiguous/absent name", () => {
    expect(resolveMember([ana, luis], { license: "LIC-001", anglerName: "" })?.id).toBe("a1");
  });

  it("pairs: returns null when nothing identifies the member", () => {
    expect(resolveMember([ana, luis], {})).toBeNull();
  });

  it("pairs: returns null when the name matches both (no unique match)", () => {
    const twins: RosterMember[] = [
      { id: "a1", name: "Jose", license: "L1" },
      { id: "a2", name: "Jose", license: "L2" },
    ];
    expect(resolveMember(twins, { anglerName: "Jose" })).toBeNull();
  });

  it("no candidates → null", () => {
    expect(resolveMember([], { license: "LIC-001" })).toBeNull();
  });
});
