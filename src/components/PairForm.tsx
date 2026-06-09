"use client";
import { useState } from "react";
import { createPair } from "@/app/[locale]/admin/actions";

interface AnglerOption {
  id: string;
  name: string;
}

interface PairFormLabels {
  angler1: string;
  angler2: string;
  namePlaceholder: string;
  create: string;
}

/**
 * Issue 34 — Pair creation form. The angler chosen in one selector is excluded
 * from the other (and vice versa), so the same person can't be picked twice. The
 * server still validates two distinct anglers (createPair) as a safety net.
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
  const [angler1, setAngler1] = useState("");
  const [angler2, setAngler2] = useState("");

  return (
    <form action={createPair} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="competition_id" value={competitionId} />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <select name="angler1_id" required value={angler1} onChange={(e) => setAngler1(e.target.value)}>
          <option value="">{labels.angler1}</option>
          {anglers
            .filter((a) => a.id !== angler2)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <select name="angler2_id" required value={angler2} onChange={(e) => setAngler2(e.target.value)}>
          <option value="">{labels.angler2}</option>
          {anglers
            .filter((a) => a.id !== angler1)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </div>
      <input name="name" placeholder={labels.namePlaceholder} />
      <button className="primary" type="submit">
        {labels.create}
      </button>
    </form>
  );
}
