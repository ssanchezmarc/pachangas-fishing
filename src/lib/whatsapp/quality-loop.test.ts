import { describe, it, expect } from "vitest";
import { controllerMessage } from "./quality-loop";
import type { IngestOutcome } from "./ingest";

describe("controllerMessage (issue 11 quality loop)", () => {
  it("stays silent when the read is clean (auto)", () => {
    const outcome: IngestOutcome = {
      kind: "stored",
      scorecardId: "s1",
      status: "auto",
      issues: [],
      lot: "17",
      resend: false,
    };
    expect(controllerMessage(outcome)).toBeNull();
  });

  it("asks the controller to resend/confirm on a flagged read, citing the reason", () => {
    const outcome: IngestOutcome = {
      kind: "stored",
      scorecardId: "s1",
      status: "flagged",
      issues: [{ code: "legalCatchesMismatch", params: { read: 3, total: 4 } }],
      lot: "17",
      resend: false,
    };
    const msg = controllerMessage(outcome);
    expect(msg).toContain("17");
    expect(msg).toContain("3");
    expect(msg).toContain("4");
    expect(msg).toMatch(/reenvías|confirmas/i);
  });

  it("asks to confirm the lot when it isn't in the roster", () => {
    const outcome: IngestOutcome = { kind: "lot_not_in_roster", lot: "99", roundId: "r1" };
    const msg = controllerMessage(outcome);
    expect(msg).toContain("99");
    expect(msg).toMatch(/censo/i);
  });

  it("keeps nagging while a resend is still flagged (stays in HITL)", () => {
    const outcome: IngestOutcome = {
      kind: "stored",
      scorecardId: "s1",
      status: "flagged",
      issues: [{ code: "signalsMismatch", params: { index: 2, tens: 2, units: 1, size: 23 } }],
      lot: "17",
      resend: true,
    };
    expect(controllerMessage(outcome)).not.toBeNull();
  });

  it("is silent for no active round, final round or already-settled plica", () => {
    expect(controllerMessage({ kind: "no_active_round" })).toBeNull();
    expect(controllerMessage({ kind: "round_final" })).toBeNull();
    expect(controllerMessage({ kind: "already_settled", scorecardId: "s1" })).toBeNull();
  });
});
