"use client";

import { useRef, useState } from "react";
import { createCompetition } from "@/app/[locale]/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";

export interface CompetitionFormLabels {
  name: string;
  typeIndividual: string;
  typePairs: string;
  visibilityLabel: string;
  visibilityPublic: string;
  visibilityPrivate: string;
  placeHeading: string;
  placeHelp: string;
  river: string;
  venue: string;
  sectorName: string;
  addSector: string;
  remove: string;
  roundsHeading: string;
  roundName: string;
  roundDate: string;
  addRound: string;
  lotsHeading: string;
  lotsHelp: string;
  lotsPlaceholder: string;
  create: string;
  working: string;
}

interface SectorRow {
  key: number;
  river: string;
  venue: string;
  name: string;
}
interface RoundRow {
  key: number;
  name: string;
  date: string;
}

/** Parses "1-20, 25, 30" into a deduped, sorted list of lot numbers. */
function parseLots(raw: string): number[] {
  const out: number[] = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a <= b) for (let n = a; n <= b; n++) out.push(n);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/**
 * Issue 45/49 — Create a competition with its place already set up: name, type,
 * visibility, plus optional sectors (river/venue/name, with river+venue pre-filled
 * from the previous row since they usually repeat), rounds (name/date) and lots
 * (numbers, comma-separated or ranges). Sectors/rounds/lots travel to the server
 * action as JSON hidden fields. Anglers/pairs are added later in the view.
 */
export function CompetitionForm({
  clubId,
  labels,
}: {
  clubId: string;
  labels: CompetitionFormLabels;
}) {
  const nextKey = useRef(1);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [lots, setLots] = useState("");

  const addSector = () =>
    setSectors((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        { key: nextKey.current++, river: last?.river ?? "", venue: last?.venue ?? "", name: "" },
      ];
    });
  const addRound = () =>
    setRounds((prev) => [...prev, { key: nextKey.current++, name: "", date: "" }]);

  const sectorsJson = JSON.stringify(
    sectors
      .map((s) => ({ river: s.river.trim(), venue: s.venue.trim(), name: s.name.trim() }))
      .filter((s) => s.name.length > 0),
  );
  const roundsJson = JSON.stringify(
    rounds
      .map((r) => ({ name: r.name.trim(), date: r.date }))
      .filter((r) => r.name.length > 0 && r.date),
  );
  const lotsJson = JSON.stringify(parseLots(lots));

  return (
    <form action={createCompetition} style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
      <input type="hidden" name="club_id" value={clubId} />
      <input type="hidden" name="sectors" value={sectorsJson} />
      <input type="hidden" name="rounds" value={roundsJson} />
      <input type="hidden" name="lots" value={lotsJson} />

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input name="name" placeholder={labels.name} required style={{ flex: 1, minWidth: 180 }} />
        <select name="type" defaultValue="pairs">
          <option value="pairs">{labels.typePairs}</option>
          <option value="individual">{labels.typeIndividual}</option>
        </select>
        <label className="muted" style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 4 }}>
          {labels.visibilityLabel}
          <select name="visibility" defaultValue="public">
            <option value="public">{labels.visibilityPublic}</option>
            <option value="private">{labels.visibilityPrivate}</option>
          </select>
        </label>
      </div>

      {/* Place: sectors (river/venue/name). */}
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
        <legend style={{ fontSize: "0.85rem" }}>{labels.placeHeading}</legend>
        <p className="muted" style={{ marginTop: 0 }}>{labels.placeHelp}</p>
        {sectors.map((s, i) => (
          <div key={s.key} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <input
              placeholder={labels.river}
              value={s.river}
              onChange={(e) => setSectors((p) => p.map((x, j) => (j === i ? { ...x, river: e.target.value } : x)))}
            />
            <input
              placeholder={labels.venue}
              value={s.venue}
              onChange={(e) => setSectors((p) => p.map((x, j) => (j === i ? { ...x, venue: e.target.value } : x)))}
            />
            <input
              placeholder={labels.sectorName}
              value={s.name}
              onChange={(e) => setSectors((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <button type="button" className="tab" onClick={() => setSectors((p) => p.filter((_, j) => j !== i))}>
              {labels.remove}
            </button>
          </div>
        ))}
        <button type="button" className="tab" onClick={addSector}>
          {labels.addSector}
        </button>
      </fieldset>

      {/* Rounds (name + date). */}
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
        <legend style={{ fontSize: "0.85rem" }}>{labels.roundsHeading}</legend>
        {rounds.map((r, i) => (
          <div key={r.key} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <input
              placeholder={labels.roundName}
              value={r.name}
              onChange={(e) => setRounds((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              type="date"
              value={r.date}
              onChange={(e) => setRounds((p) => p.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
            />
            <button type="button" className="tab" onClick={() => setRounds((p) => p.filter((_, j) => j !== i))}>
              {labels.remove}
            </button>
          </div>
        ))}
        <button type="button" className="tab" onClick={addRound}>
          {labels.addRound}
        </button>
      </fieldset>

      {/* Lots (numbers). */}
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 0.75rem" }}>
        <legend style={{ fontSize: "0.85rem" }}>{labels.lotsHeading}</legend>
        <p className="muted" style={{ marginTop: 0 }}>{labels.lotsHelp}</p>
        <input
          value={lots}
          onChange={(e) => setLots(e.target.value)}
          placeholder={labels.lotsPlaceholder}
          style={{ width: "100%" }}
        />
      </fieldset>

      <SubmitButton pendingLabel={labels.working}>{labels.create}</SubmitButton>
    </form>
  );
}
