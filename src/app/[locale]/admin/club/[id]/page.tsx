import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateClub, inviteOrganizer, removeOrganizer, listClubOrganizers } from "../../actions";
import { CompetitionForm } from "@/components/CompetitionForm";
import { SubmitButton } from "@/components/SubmitButton";
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

  const organizers = await listClubOrganizers(id);

  return (
    <main className="container">
      <p className="muted">
        <Link href="/admin">{t("back")}</Link>
      </p>
      <h1>{c.name}</h1>

      {/* Issue 48 — rename the club (identified by its stable UUID, not its name). */}
      <section className="card">
        <h2>{t("clubName")}</h2>
        <form action={updateClub} style={{ display: "flex", gap: "0.5rem" }}>
          <input type="hidden" name="club_id" value={id} />
          <input name="name" defaultValue={c.name} required style={{ flex: 1, minWidth: 200 }} />
          <SubmitButton pendingLabel={t("working")}>{t("saveClubName")}</SubmitButton>
        </form>
      </section>

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
        <CompetitionForm
          clubId={id}
          labels={{
            name: t("newCompetition"),
            typeIndividual: ta("type.individual"),
            typePairs: ta("type.pairs"),
            visibilityLabel: t("visibilityLabel"),
            visibilityPublic: t("visibilityPublic"),
            visibilityPrivate: t("visibilityPrivate"),
            placeHeading: t("placeHeading"),
            placeHelp: t("placeHelp"),
            river: t("river"),
            venue: t("venue"),
            sectorName: t("sectorName"),
            addSector: t("addSector"),
            remove: t("remove"),
            roundsHeading: t("roundsHeading"),
            roundName: t("roundName"),
            roundDate: t("roundDate"),
            addRound: t("addRound"),
            lotsHeading: t("lotsHeading"),
            lotsHelp: t("lotsHelp"),
            lotsPlaceholder: t("lotsPlaceholder"),
            create: t("create"),
            working: t("working"),
          }}
        />
      </section>

      {/* Issue 37 — Organizers of this club: list, invite/link by email, remove. */}
      <section className="card">
        <h2>{t("organizers")}</h2>
        <p className="muted">{t("organizersHelp")}</p>
        {organizers.map((o) => (
          <div
            key={o.user_id}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}
          >
            <span>
              {o.email} <span className="muted">· {o.role}</span>
            </span>
            {organizers.length > 1 && (
              <form action={removeOrganizer}>
                <input type="hidden" name="club_id" value={id} />
                <input type="hidden" name="user_id" value={o.user_id} />
                <SubmitButton className="" pendingLabel={t("working")}>{t("removeOrganizer")}</SubmitButton>
              </form>
            )}
          </div>
        ))}
        <form action={inviteOrganizer} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input type="hidden" name="club_id" value={id} />
          <input name="email" type="email" placeholder={t("organizerEmail")} required style={{ flex: 1, minWidth: 220 }} />
          <SubmitButton pendingLabel={t("working")}>{t("inviteOrganizer")}</SubmitButton>
        </form>
      </section>
    </main>
  );
}
