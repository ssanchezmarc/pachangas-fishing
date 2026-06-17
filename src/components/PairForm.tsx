"use client";
import { useState } from "react";
import { createPairFull } from "@/app/[locale]/admin/actions";

interface AnglerOption {
  id: string;
  name: string;
}

interface PairFormLabels {
  angler1: string;
  angler2: string;
  namePlaceholder: string;
  create: string;
  /** Toggle: pick an existing roster angler. */
  fromRoster: string;
  /** Toggle: register a new angler inline. */
  newAngler: string;
  newName: string;
  newLicense: string;
}

type Mode = "existing" | "new";

/**
 * Issue 44 — Defines a full pair in one step: each member is either chosen from the
 * roster or created inline (name + license), so there is no separate "register
 * angler" step before forming the pair.
 *
 * Issue 34 — When both members are picked from the roster, the angler chosen in one
 * selector is excluded from the other (and vice versa). The server (createPairFull)
 * still validates two distinct anglers as a safety net.
 */
export function PairForm({
  competitionId,
  anglers,
  labels,
}: {
  competitionId: string;
  anglers: AnglerOption[];
  labels: PairFormLabels;
}) {
  const [mode1, setMode1] = useState<Mode>(anglers.length ? "existing" : "new");
  const [mode2, setMode2] = useState<Mode>(anglers.length ? "existing" : "new");
  const [angler1, setAngler1] = useState("");
  const [angler2, setAngler2] = useState("");

  const member = (
    n: 1 | 2,
    mode: Mode,
    setMode: (m: Mode) => void,
    value: string,
    setValue: (v: string) => void,
    otherValue: string,
    placeholder: string,
  ) => (
    <div style={{ display: "grid", gap: "0.35rem", flex: 1, minWidth: 200 }}>
      {anglers.length > 0 && (
        <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem" }}>
          <label>
            <input
              type="radio"
              name={`mode${n}`}
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
            />{" "}
            {labels.fromRoster}
          </label>
          <label>
            <input
              type="radio"
              name={`mode${n}`}
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />{" "}
            {labels.newAngler}
          </label>
        </div>
      )}
      {mode === "existing" ? (
        <select
          name={`angler${n}_id`}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {anglers
            .filter((a) => a.id !== otherValue)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      ) : (
        <>
          <input name={`angler${n}_name`} placeholder={labels.newName} required />
          <input name={`angler${n}_license`} placeholder={labels.newLicense} required />
        </>
      )}
    </div>
  );

  return (
    <form action={createPairFull} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="competition_id" value={competitionId} />
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {member(1, mode1, setMode1, angler1, setAngler1, angler2, labels.angler1)}
        {member(2, mode2, setMode2, angler2, setAngler2, angler1, labels.angler2)}
      </div>
      <input name="name" placeholder={labels.namePlaceholder} />
      <button className="primary" type="submit">
        {labels.create}
      </button>
    </form>
  );
}
