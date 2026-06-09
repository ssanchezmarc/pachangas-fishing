import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LiveStandings } from "@/components/LiveStandings";
import { loadCompetitionStandings } from "@/lib/data";
import { phaseLabel } from "@/domain/phases";

export const dynamic = "force-dynamic";

/**
 * Issue 15 — Public competition page: the aggregated standings over all its rounds
 * (FEPyC sum of placings) plus the list of rounds, each linking to its own
 * standings. This is the hierarchy anglers understand the event by.
 */
export default async function CompetitionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const data = await loadCompetitionStandings(id);
  if (!data) notFound();

  return (
    <main className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <p className="muted">
          <Link href="/">{t("competition.backHome")}</Link>
        </p>
        <LanguageSwitcher />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>{data.competition.name}</h1>
        <span className="muted">{t(`admin.type.${data.competition.type}`)}</span>
      </div>

      <h2>{t("competition.overallStandings")}</h2>
      <LiveStandings
        type={data.competition.type}
        endpoint={`/api/competition/${id}/standings`}
        initial={{ individual: data.individual, pairs: data.pairs }}
      />

      {/* Issue 18/31 — per-phase standings (the rounds grouped into phases A, B…). */}
      {data.groups.length > 0 && (
        <>
          <h2 style={{ marginTop: "2rem" }}>{t("competition.phasesHeading")}</h2>
          {data.groups.map((g) => (
            <div key={g.key} style={{ marginTop: "1rem" }}>
              <h3>
                {g.groupIndex !== null
                  ? t("competition.phaseLabel", { letter: phaseLabel(g.groupIndex) })
                  : g.roundNames[0]}{" "}
                <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
                  {g.roundNames.join(" + ")}
                </span>
              </h3>
              <LiveStandings
                type={data.competition.type}
                endpoint=""
                initial={{ individual: g.individual, pairs: g.pairs }}
              />
            </div>
          ))}
        </>
      )}

      <h2 style={{ marginTop: "2rem" }}>{t("competition.roundsHeading")}</h2>
      {data.rounds.length === 0 && <p className="muted">{t("competition.noRounds")}</p>}
      {data.rounds.map((r) => (
        <Link key={r.id} href={`/round/${r.id}`} className="card" style={{ display: "block" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{r.name}</strong>
              <div className="muted">{r.date}</div>
            </div>
            <span className={`badge ${r.status}`}>{t(`status.round.${r.status}`)}</span>
          </div>
        </Link>
      ))}
    </main>
  );
}
