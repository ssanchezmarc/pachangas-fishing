import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCompetition } from "../../actions";
import type { Club, Competition } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Issue 29 — Club workspace: the competitions of the selected club. A competition
 * is created here (inside this club); everything else hangs off the competition.
 */
export default async function AdminClubPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("adminClub");
  const ta = await getTranslations("admin");
  const tc = await getTranslations("status");

  const supabase = await createSupabaseServerClient();
  const { data: club } = await supabase.from("club").select("*").eq("id", id).single();
  if (!club) notFound();
  const c = club as Club;

  const { data: competitions } = await supabase
    .from("competition")
    .select("*")
    .eq("club_id", id)
    .order("created_at", { ascending: false });
  const comps = (competitions ?? []) as Competition[];

  return (
    <main className="container">
      <p className="muted">
        <Link href="/admin">{t("back")}</Link>
      </p>
      <h1>{c.name}</h1>

      <section className="card">
        <h2>{t("competitions")}</h2>
        {comps.length === 0 && <p className="muted">{t("noCompetitions")}</p>}
        {comps.map((comp) => (
          <div key={comp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <Link href={`/admin/competition/${comp.id}`}>{comp.name}</Link>{" "}
              <span className="muted">· {ta(`type.${comp.type}`)}</span>
            </span>
            <span className={`badge ${comp.status}`}>{tc(`competition.${comp.status}`)}</span>
          </div>
        ))}
        <form action={createCompetition} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <input type="hidden" name="club_id" value={id} />
          <input name="name" placeholder={t("newCompetition")} required />
          <select name="type" defaultValue="pairs">
            <option value="pairs">{ta("type.pairs")}</option>
            <option value="individual">{ta("type.individual")}</option>
          </select>
          <button className="primary" type="submit">
            {t("create")}
          </button>
        </form>
      </section>
    </main>
  );
}
