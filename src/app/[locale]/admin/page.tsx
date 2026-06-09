import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCompetition, createAngler, signOut } from "./actions";
import type { Competition, Angler } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Issue 17 — Admin organized by competition. The landing lists competitions (each
 * links to its management page) and the club-level angler roster (people exist
 * independent of any competition; lots assign them to one).
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const tc = await getTranslations("status");

  const supabase = await createSupabaseServerClient();
  const [{ data: competitions }, { data: anglers }] = await Promise.all([
    supabase.from("competition").select("*").order("created_at", { ascending: false }),
    supabase.from("angler").select("*").order("name"),
  ]);

  const comps = (competitions ?? []) as Competition[];
  const anglerList = (anglers ?? []) as Angler[];

  return (
    <main className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <h1>{t("title")}</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <LanguageSwitcher />
          <form action={signOut}>
            <button className="tab" type="submit">
              {t("signOut")}
            </button>
          </form>
        </div>
      </div>

      <section className="card">
        <h2>{t("competitions")}</h2>
        {comps.length === 0 && <p className="muted">{t("noCompetitions")}</p>}
        {comps.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <Link href={`/admin/competition/${c.id}`}>{c.name}</Link>{" "}
              <span className="muted">· {t(`type.${c.type}`)}</span>
            </span>
            <span className={`badge ${c.status}`}>{tc(`competition.${c.status}`)}</span>
          </div>
        ))}
        <form action={createCompetition} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <input name="name" placeholder={t("newCompetition")} required />
          <select name="type" defaultValue="pairs">
            <option value="pairs">{t("type.pairs")}</option>
            <option value="individual">{t("type.individual")}</option>
          </select>
          <button className="primary" type="submit">
            {t("create")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("anglers")}</h2>
        <div className="muted">{t("anglersCount", { count: anglerList.length })}</div>
        <form action={createAngler} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input name="name" placeholder={t("anglerName")} required />
            <input name="license_number" placeholder={t("licenseNumber")} required />
            <input name="federation_number" placeholder={t("federationNumber")} />
            <input name="phone" type="tel" placeholder={t("phone")} />
          </div>
          <button className="primary" type="submit">
            {t("add")}
          </button>
        </form>
      </section>
    </main>
  );
}
