import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccessCodeForm } from "@/components/AccessCodeForm";
import { listCompetitions } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Issue 15 — Public landing: lists competitions (not loose rounds). Each links to
 * its competition page (aggregated standings + its rounds).
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  let competitions: Awaited<ReturnType<typeof listCompetitions>> = [];
  let error = false;
  try {
    competitions = await listCompetitions();
  } catch {
    error = true;
  }

  return (
    <main className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <h1>🎣 {t("common.appName")}</h1>
        <LanguageSwitcher />
      </div>
      <p className="muted">{t("common.tagline")}</p>

      {error && (
        <div className="card">
          <strong>{t("home.noConnectionTitle")}</strong>
          <p className="muted">{t("home.noConnectionBody")}</p>
        </div>
      )}

      <h2>{t("home.competitionsHeading")}</h2>
      {competitions.length === 0 && !error && <p className="muted">{t("home.noCompetitions")}</p>}
      {competitions.map((c) => {
        const dateRange =
          c.dateStart && c.dateEnd
            ? c.dateStart === c.dateEnd
              ? c.dateStart
              : t("home.dateRange", { from: c.dateStart, to: c.dateEnd })
            : null;
        return (
          <Link key={c.id} href={`/competition/${c.id}`} className="card" style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{c.name}</strong>
              <span className="muted">{t(`admin.type.${c.type}`)}</span>
            </div>
            <div className="muted" style={{ marginTop: "0.25rem" }}>
              {c.clubName && <span>{c.clubName}</span>}
              {c.clubName && dateRange && <span> · </span>}
              {dateRange && <span>{dateRange}</span>}
            </div>
          </Link>
        );
      })}

      {/* Issue 45 — reach a private competition with the code organizers hand out. */}
      <section style={{ marginTop: "2rem" }}>
        <h2>{t("home.accessCodeHeading")}</h2>
        <p className="muted">{t("home.accessCodeHelp")}</p>
        <AccessCodeForm
          labels={{ placeholder: t("home.accessCodePlaceholder"), submit: t("home.accessCodeSubmit") }}
        />
      </section>

      <p className="muted" style={{ marginTop: "2rem" }}>
        <Link href="/admin">{t("home.organizersAccess")}</Link>
      </p>
    </main>
  );
}
