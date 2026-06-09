import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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
      {competitions.map((c) => (
        <Link key={c.id} href={`/competition/${c.id}`} className="card" style={{ display: "block" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{c.name}</strong>
            <span className="muted">{t(`admin.type.${c.type}`)}</span>
          </div>
        </Link>
      ))}

      <p className="muted" style={{ marginTop: "2rem" }}>
        <Link href="/admin">{t("home.organizersAccess")}</Link>
      </p>
    </main>
  );
}
