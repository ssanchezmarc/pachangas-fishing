/**
 * Issue 11 — Conversational quality loop. When a reading fails validation or comes
 * with low confidence (issue 08), the bot replies to the controller WHILE they
 * still have the paper, asking for a clearer photo or a confirmation. A resend is
 * just another inbound photo: it re-runs reading + validation and updates the same
 * plica (see ingestReading). If the incoherence persists, the plica stays
 * `flagged`, i.e. in the committee HITL queue (issue 09).
 *
 * Pure: turns an ingest outcome into the controller-facing message (Spanish — the
 * audience is the club's controllers), or null when nothing needs to be said.
 */
import type { ValidationIssue } from "@/domain/validation";
import type { IngestOutcome } from "./ingest";

/** Short Spanish phrase per validation issue, for the controller message. */
function describeIssue(issue: ValidationIssue): string {
  const p = issue.params ?? {};
  switch (issue.code) {
    case "signalsMismatch":
      return `en la pieza ${p.index} las marcas (${p.tens}${p.units}) no cuadran con la talla escrita (${p.size})`;
    case "legalCatchesMismatch":
      return `leo ${p.read} capturas de talla pero el total dice ${p.total}`;
    case "undersizedMismatch":
      return `leo ${p.read} menores de talla pero el total dice ${p.total}`;
    case "biggestCatchMismatch":
      return `leo ${p.read} cm de pieza mayor pero el total dice ${p.total} cm`;
    case "lotNotInRoster":
      return `el lote ${p.lot} no está en el censo de la manga`;
    case "lowLotConfidence":
      return "no leo bien el lote";
    case "lowCatchesConfidence":
      return "no leo bien las piezas";
    case "lowTotalsConfidence":
      return "no leo bien los totales del pie";
    default:
      return "hay algo que no cuadra";
  }
}

/**
 * The message to send to the controller for an ingest outcome, or null when no
 * action is needed (read OK → auto, no active round, already settled).
 */
export function controllerMessage(outcome: IngestOutcome): string | null {
  switch (outcome.kind) {
    case "lot_not_in_roster":
      return `⚠️ El lote ${outcome.lot} no está en el censo de la manga activa. ¿Confirmas el número de lote o reenvías una foto más nítida?`;
    case "stored": {
      if (outcome.status === "auto") return null; // read clean: nothing to ask.
      const reason = outcome.issues.length ? describeIssue(outcome.issues[0]) : "hay algo que no cuadra";
      return `⚠️ Plica lote ${outcome.lot}: ${reason}. ¿Reenvías una foto más nítida o confirmas?`;
    }
    case "no_active_round":
    case "round_final":
    case "already_settled":
      return null;
  }
}
