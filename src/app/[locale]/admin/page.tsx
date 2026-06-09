import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClub, signOut } from "./actions";
import type { Club } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Issue 29 — Multi-club landing. The first thing an organizer does is pick the
 * club to work in: this lists the clubs they belong to (club_member) and lets them
 * create a new one. The competitions live one level down, at /admin/club/[clubId].
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: members } = user
    ? await supabase.from("club_member").select("club_id").eq("user_id", user.id)
    : { data: [] };
  const clubIds = (members ?? []).map((m: { club_id: string }) => m.club_id);
  const { data: clubs } = clubIds.length
    ? await supabase.from("club").select("*").in("id", clubIds).order("name")
    : { data: [] as Club[] };
  const clubList = (clubs ?? []) as Club[];

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
        <h2>{t("clubs")}</h2>
        {clubList.length === 0 && <p className="muted">{t("noClubs")}</p>}
        {clubList.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link href={`/admin/club/${c.id}`}>{c.name}</Link>
            <Link href={`/admin/club/${c.id}`} className="muted">
              {t("openClub")}
            </Link>
          </div>
        ))}
        <form action={createClub} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <input name="name" placeholder={t("newClub")} required />
          <button className="primary" type="submit">
            {t("createClub")}
          </button>
        </form>
      </section>
    </main>
  );
}
