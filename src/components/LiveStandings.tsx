"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { CompetitionType } from "@/domain/types";
import type { IndividualRow, PairRow } from "@/lib/data";

/** Refresh interval (PRD §10: polling 15–30 s). */
const INTERVAL_MS = 20_000;

export interface StandingsData {
  individual: IndividualRow[];
  pairs: PairRow[];
}

/** Unified row shape so the podium + table work for individual and pairs alike. */
interface StandingRow {
  position: number;
  name: string;
  detail?: string;
  placingsSum: number;
  totalCatchPoints: number;
  biggestCatchCm: number;
}

/**
 * Live standings view shared by the round and competition pages (issues 15/16/27).
 * Shows only the table the competition type calls for, highlights the podium
 * (issue 27), and polls `endpoint` for updates. The endpoint returns
 * `{ individual, pairs }`.
 */
export function LiveStandings({
  type,
  endpoint,
  initial,
}: {
  type: CompetitionType;
  endpoint: string;
  initial: StandingsData;
}) {
  const t = useTranslations("round");
  const [data, setData] = useState<StandingsData>(initial);
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    // No endpoint → render the given data without polling (e.g. group standings).
    if (!endpoint) return;
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok || !active) return;
        const next = (await res.json()) as StandingsData;
        if (active) {
          setData(next);
          setRefreshed(true);
          setTimeout(() => active && setRefreshed(false), 1200);
        }
      } catch {
        // Silent: retries on the next tick.
      }
    }, INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [endpoint]);

  const rows: StandingRow[] =
    type === "individual"
      ? data.individual.map((f) => ({
          position: f.position,
          name: f.angler,
          detail: f.sector,
          placingsSum: f.placingsSum,
          totalCatchPoints: f.totalCatchPoints,
          biggestCatchCm: f.biggestCatchCm,
        }))
      : data.pairs.map((f) => ({
          position: f.position,
          name: f.pair,
          placingsSum: f.placingsSum,
          totalCatchPoints: f.totalCatchPoints,
          biggestCatchCm: f.biggestCatchCm,
        }));

  const empty = type === "individual" ? t("noStandings") : t("noPairsStandings");
  // Sector column only makes sense for the individual per-round table.
  const showDetail = type === "individual" && rows.some((r) => r.detail);

  return (
    <div>
      <div className="tabs" role="tablist">
        <button role="tab" className="tab" aria-selected disabled>
          {type === "individual" ? t("individual") : t("pairs")}
        </button>
        {endpoint && (
          <span className="muted" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
            {refreshed ? t("updated") : t("refreshEvery", { seconds: INTERVAL_MS / 1000 })}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <StandingsBlock
          rows={rows}
          nameHeader={type === "individual" ? t("thAngler") : t("thPair")}
          showDetail={showDetail}
        />
      )}
    </div>
  );
}

function StandingsBlock({
  rows,
  nameHeader,
  showDetail,
}: {
  rows: StandingRow[];
  nameHeader: string;
  showDetail: boolean;
}) {
  // Issue 27 — podium (positions 1–3, ties included) on top, the rest below.
  const podium = rows.filter((r) => r.position <= 3);
  const rest = rows.filter((r) => r.position > 3);

  return (
    <div>
      <Podium entries={podium} />
      {rest.length > 0 && <RestTable rows={rest} nameHeader={nameHeader} showDetail={showDetail} />}
    </div>
  );
}

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Podium({ entries }: { entries: StandingRow[] }) {
  const t = useTranslations("round");
  return (
    <ol className="podium">
      {entries.map((e, i) => (
        <li key={`${e.name}-${i}`} className={`podium-place place-${e.position}`}>
          <div className="podium-medal">{MEDAL[e.position] ?? e.position}</div>
          <div className="podium-name">{e.name}</div>
          {e.detail && <div className="muted podium-detail">{e.detail}</div>}
          <div className="podium-stats muted">
            {t("thPlacings")} {e.placingsSum} · {e.totalCatchPoints.toFixed(2)} {t("thCatchPoints")}
          </div>
        </li>
      ))}
    </ol>
  );
}

function RestTable({
  rows,
  nameHeader,
  showDetail,
}: {
  rows: StandingRow[];
  nameHeader: string;
  showDetail: boolean;
}) {
  const t = useTranslations("round");
  return (
    <table>
      <thead>
        <tr>
          <th className="num">{t("thPosition")}</th>
          <th>{nameHeader}</th>
          {showDetail && <th>{t("thSector")}</th>}
          <th className="num">{t("thPlacings")}</th>
          <th className="num">{t("thCatchPoints")}</th>
          <th className="num">{t("thBiggestCatch")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f, i) => (
          <tr key={`${f.name}-${i}`}>
            <td className="num">{f.position}</td>
            <td>{f.name}</td>
            {showDetail && <td>{f.detail}</td>}
            <td className="num">{f.placingsSum}</td>
            <td className="num">{f.totalCatchPoints.toFixed(2)}</td>
            <td className="num">{f.biggestCatchCm > 0 ? `${f.biggestCatchCm} cm` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
