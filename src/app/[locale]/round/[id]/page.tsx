import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadRoundStandings } from "@/lib/data";
import { LiveStandings } from "@/components/LiveStandings";

export const dynamic = "force-dynamic";

export default async function RoundPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const data = await loadRoundStandings(id);
  if (!data) notFound();

  const provisionalOrFinal = data.round.status === "provisional" || data.round.status === "final";

  return (
    <main className="container">
      <p className="muted">
        <Link href="/">{t("round.backRounds")}</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>{data.round.name}</h1>
        <span className={`badge ${data.round.status}`}>{t(`status.round.${data.round.status}`)}</span>
      </div>
      <p className="muted">
        {data.competition.name} · {data.round.date}
        {data.round.start_time ? ` · ${data.round.start_time}–${data.round.end_time}` : ""}
      </p>

      {provisionalOrFinal && (
        <div className="card">
          <span className={`badge ${data.round.status}`}>
            {t(`status.round.${data.round.status}`)}
          </span>{" "}
          {data.round.status === "final" ? t("round.finalNotice") : t("round.provisionalNotice")}
        </div>
      )}

      <LiveStandings
        type={data.competition.type}
        endpoint={`/api/round/${id}/standings`}
        initial={{ individual: data.individual, pairs: data.pairs }}
      />
    </main>
  );
}
