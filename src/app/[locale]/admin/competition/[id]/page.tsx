import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createRound, createLot, createPair, transitionCompetition, setRoundGroup } from "../../actions";
import { COMPETITION_STATUSES } from "@/domain/competition-status";
import type { Competition, Round, Lot, Pair, Angler } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Issue 17 — Admin management page of a single competition: its rounds, its lots
 * (the sorteo draw assigning anglers), and — only when the competition is a pairs
 * one (issue 16) — its pairs. The club angler roster lives at /admin.
 */
export default async function AdminCompetitionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("adminCompetition");
  const ta = await getTranslations("admin");
  const tc = await getTranslations("status");

  const supabase = await createSupabaseServerClient();
  const { data: competition } = await supabase.from("competition").select("*").eq("id", id).single();
  if (!competition) notFound();
  const c = competition as Competition;

  const [{ data: rounds }, { data: lots }, { data: pairs }, { data: anglers }] = await Promise.all([
    supabase.from("round").select("*").eq("competition_id", id).order("date"),
    supabase.from("lot").select("*").eq("competition_id", id).order("number"),
    supabase.from("pair").select("*").eq("competition_id", id),
    supabase.from("angler").select("*").order("name"),
  ]);

  const roundList = (rounds ?? []) as Round[];
  const lotList = (lots ?? []) as Lot[];
  const pairList = (pairs ?? []) as Pair[];
  const anglerList = (anglers ?? []) as Angler[];
  const anglerName = new Map(anglerList.map((a) => [a.id, a.name]));

  return (
    <main className="container">
      <p className="muted">
        <Link href="/admin">{t("back")}</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>{c.name}</h1>
        <span className="muted">{ta(`type.${c.type}`)}</span>
      </div>

      {/* Issue 28 — competition lifecycle (free transitions, audited). */}
      <section className="card">
        <h2>{t("lifecycle")}</h2>
        <p>
          <span className={`badge ${c.status}`}>{tc(`competition.${c.status}`)}</span>{" "}
          <span className="muted">· {t("lifecycleHelp")}</span>
        </p>
        <form action={transitionCompetition} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="hidden" name="competition_id" value={id} />
          <select name="to" defaultValue={c.status}>
            {COMPETITION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tc(`competition.${s}`)}
              </option>
            ))}
          </select>
          <button className="primary" type="submit">
            {t("changeStatus")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("rounds")}</h2>
        <p className="muted">{t("groupsHelp")}</p>
        {roundList.length === 0 && <p className="muted">{t("noRounds")}</p>}
        {roundList.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <span>
              <Link href={`/admin/round/${r.id}`}>{r.name}</Link>{" "}
              <span className="muted">· {r.date}</span>
            </span>
            {/* Issue 18 — assign this round to a group (empty = ungrouped). */}
            <form action={setRoundGroup} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
              <input type="hidden" name="round_id" value={r.id} />
              <input type="hidden" name="competition_id" value={id} />
              <label className="muted" style={{ fontSize: "0.8rem" }}>
                {t("group")}
                <input
                  name="group_index"
                  type="number"
                  min={1}
                  defaultValue={r.group_index ?? ""}
                  style={{ width: 56, marginLeft: 4 }}
                />
              </label>
              <button className="tab" type="submit">
                {t("setGroup")}
              </button>
            </form>
          </div>
        ))}
        <form action={createRound} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          <input type="hidden" name="competition_id" value={id} />
          <input name="name" placeholder={t("roundName")} required />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input name="date" type="date" required />
            <input name="start_time" type="time" />
            <input name="end_time" type="time" />
            <input name="group_index" type="number" min={1} placeholder={t("group")} style={{ width: 90 }} />
          </div>
          <button className="primary" type="submit">
            {t("createRound")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("lots")}</h2>
        {lotList.length === 0 && <p className="muted">{t("noLots")}</p>}
        {lotList.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t("thLot")}</th>
                <th>{t("thAngler")}</th>
              </tr>
            </thead>
            <tbody>
              {lotList.map((l) => (
                <tr key={l.id}>
                  <td>#{l.number}</td>
                  <td>{anglerName.get(l.angler_id) ?? "?"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={createLot} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input type="hidden" name="competition_id" value={id} />
          <input name="number" type="number" min={1} placeholder={t("lotNumber")} required style={{ width: 100 }} />
          <select name="angler_id" required>
            <option value="">{t("lotAngler")}</option>
            {anglerList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="primary" type="submit">
            {t("createLot")}
          </button>
        </form>
      </section>

      {/* Pairs management only for pairs competitions (issue 16/17). */}
      {c.type === "pairs" && (
        <section className="card">
          <h2>{t("pairs")}</h2>
          <div className="muted">{t("pairsCount", { count: pairList.length })}</div>
          {pairList.map((p) => (
            <div key={p.id}>
              · {p.name ?? `${anglerName.get(p.angler1_id) ?? "?"} / ${anglerName.get(p.angler2_id) ?? "?"}`}
            </div>
          ))}
          <form action={createPair} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
            <input type="hidden" name="competition_id" value={id} />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <select name="angler1_id" required>
                <option value="">{t("angler1")}</option>
                {anglerList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select name="angler2_id" required>
                <option value="">{t("angler2")}</option>
                {anglerList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <input name="name" placeholder={t("pairNamePlaceholder")} />
            <button className="primary" type="submit">
              {t("createPair")}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
