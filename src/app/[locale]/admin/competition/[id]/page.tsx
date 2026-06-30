import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createRound, createLot, createSector, updateSector, deleteSector, assignLotAngler, assignLotPair, addEntry, createAngler, transitionCompetition, toggleCompetitionVisibility, setRoundGroup, deleteCompetition } from "../../actions";
import { COMPETITION_STATUSES } from "@/domain/competition-status";
import { phaseLabel } from "@/domain/phases";
import { sectorLabel } from "@/domain/sector";
import { PairForm } from "@/components/PairForm";
import { SubmitButton } from "@/components/SubmitButton";
import type { Competition, Round, Lot, Pair, Angler, Sector, RoundEntry } from "@/lib/supabase/types";

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

  const [{ data: rounds }, { data: lots }, { data: pairs }, { data: anglers }, { data: sectors }, { data: entries }] = await Promise.all([
    supabase.from("round").select("*").eq("competition_id", id).order("date"),
    supabase.from("lot").select("*").eq("competition_id", id).order("number"),
    supabase.from("pair").select("*").eq("competition_id", id),
    supabase.from("angler").select("*").eq("competition_id", id).order("name"),
    supabase.from("sector").select("*").eq("competition_id", id).order("name"),
    supabase.from("round_entry").select("*").eq("competition_id", id),
  ]);

  const roundList = (rounds ?? []) as Round[];
  const lotList = (lots ?? []) as Lot[];
  const pairList = (pairs ?? []) as Pair[];
  const anglerList = (anglers ?? []) as Angler[];
  const sectorList = (sectors ?? []) as Sector[];
  // Issue 50 — pre-fill river/venue on the create form from the last sector (they
  // usually repeat within a competition).
  const lastSector = sectorList[sectorList.length - 1];
  // Issue 51 — the lot's per-round pattern, indexed by round+lot for the matrix.
  const entryList = (entries ?? []) as RoundEntry[];
  const entryByCell = new Map(entryList.map((e) => [`${e.round_id}:${e.lot_id}`, e]));
  const anglerName = new Map(anglerList.map((a) => [a.id, a.name]));
  const pairName = (p: Pair) =>
    p.name ?? `${anglerName.get(p.angler1_id) ?? "?"} / ${anglerName.get(p.angler2_id) ?? "?"}`;
  const pairLabelById = new Map(pairList.map((p) => [p.id, pairName(p)]));

  // Issue 45 — absolute /c/{code} link to share a private competition.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const shareLink = c.access_code ? `${proto}://${host}/c/${c.access_code}` : null;
  const isPrivate = c.visibility === "private";

  return (
    <main className="container">
      <p className="muted">
        <Link href={`/admin/club/${c.club_id}`}>{t("back")}</Link>
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
          <SubmitButton pendingLabel={t("working")}>{t("changeStatus")}</SubmitButton>
        </form>
      </section>

      {/* Issue 45 — visibility: public (listed on the home) or private (hidden,
          reached with the access code below). */}
      <section className="card">
        <h2>{t("visibility")}</h2>
        <p>
          <span className={`badge ${isPrivate ? "" : "open"}`}>
            {isPrivate ? t("visibilityPrivate") : t("visibilityPublic")}
          </span>{" "}
          <span className="muted">· {t("visibilityHelp")}</span>
        </p>
        <form action={toggleCompetitionVisibility} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="hidden" name="competition_id" value={id} />
          <input type="hidden" name="to" value={isPrivate ? "public" : "private"} />
          <SubmitButton className="tab" pendingLabel={t("working")}>
            {isPrivate ? t("makePublic") : t("makePrivate")}
          </SubmitButton>
        </form>
        {isPrivate && c.access_code && (
          <div style={{ marginTop: "0.75rem" }}>
            <div>
              {t("accessCode")}: <code>{c.access_code}</code>
            </div>
            {shareLink && (
              <div className="muted" style={{ marginTop: "0.25rem", wordBreak: "break-all" }}>
                {t("accessLink")}: <code>{shareLink}</code>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t("rounds")}</h2>
        <p className="muted">{t("phasesHelp")}</p>
        {roundList.length === 0 && <p className="muted">{t("noRounds")}</p>}
        {roundList.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <span>
              <Link href={`/admin/round/${r.id}`}>{r.name}</Link>{" "}
              <span className="muted">· {r.date}</span>
              {r.group_index !== null && (
                <span className="muted"> · {t("phase")} {phaseLabel(r.group_index)}</span>
              )}
            </span>
            {/* Issue 18/31 — assign this round to a phase (empty = no phase). */}
            <form action={setRoundGroup} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
              <input type="hidden" name="round_id" value={r.id} />
              <input type="hidden" name="competition_id" value={id} />
              <label className="muted" style={{ fontSize: "0.8rem" }}>
                {t("phase")}
                <input
                  name="phase"
                  maxLength={3}
                  placeholder="A"
                  defaultValue={r.group_index ? phaseLabel(r.group_index) : ""}
                  style={{ width: 56, marginLeft: 4 }}
                />
              </label>
              <SubmitButton className="tab" pendingLabel={t("working")}>{t("setPhase")}</SubmitButton>
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
            <input name="phase" maxLength={3} placeholder={t("phase")} style={{ width: 90 }} />
          </div>
          <SubmitButton pendingLabel={t("working")}>{t("createRound")}</SubmitButton>
        </form>
      </section>

      {/* Issue 30/52 — angler roster (individual competitions only; in pairs the
          anglers are created within the pair form). */}
      {c.type === "individual" && (
      <section className="card">
        <h2>{t("anglers")}</h2>
        <div className="muted">{t("anglersCount", { count: anglerList.length })}</div>
        {anglerList.map((a) => (
          <div key={a.id}>
            · {a.name} <span className="muted">· {a.license_number}</span>
          </div>
        ))}
        <form action={createAngler} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          <input type="hidden" name="competition_id" value={id} />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input name="name" placeholder={t("anglerName")} required />
            <input name="license_number" placeholder={t("licenseNumber")} required />
            <input name="federation_number" placeholder={t("federationNumber")} />
            <input name="phone" type="tel" placeholder={t("phone")} />
          </div>
          <SubmitButton pendingLabel={t("working")}>{t("addAngler")}</SubmitButton>
        </form>
      </section>
      )}

      {/* Issue 41 — Sectors: a competition-level reusable catalog (labels). */}
      <section className="card">
        <h2>{t("sectors")}</h2>
        <p className="muted">{t("sectorsHelp")}</p>
        {sectorList.length === 0 && <p className="muted">{t("noSectors")}</p>}
        {sectorList.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap" }}>
            <form action={updateSector} style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <input type="hidden" name="competition_id" value={id} />
              <input type="hidden" name="sector_id" value={s.id} />
              <input name="river" defaultValue={s.river} placeholder={t("river")} style={{ width: 110 }} />
              <input name="venue" defaultValue={s.venue} placeholder={t("venue")} style={{ width: 130 }} />
              <input name="name" defaultValue={s.name} placeholder={t("sectorName")} required style={{ width: 110 }} />
              <SubmitButton className="tab" pendingLabel={t("working")}>{t("saveSector")}</SubmitButton>
            </form>
            <form action={deleteSector}>
              <input type="hidden" name="competition_id" value={id} />
              <input type="hidden" name="sector_id" value={s.id} />
              <SubmitButton className="tab" pendingLabel={t("working")} style={{ color: "var(--danger, #c0392b)" }}>
                {t("deleteSector")}
              </SubmitButton>
            </form>
          </div>
        ))}
        <form action={createSector} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <input type="hidden" name="competition_id" value={id} />
          <input name="river" placeholder={t("river")} defaultValue={lastSector?.river ?? ""} style={{ width: 110 }} />
          <input name="venue" placeholder={t("venue")} defaultValue={lastSector?.venue ?? ""} style={{ width: 130 }} />
          <input name="name" placeholder={t("sectorName")} required style={{ width: 110 }} />
          <SubmitButton pendingLabel={t("working")}>{t("addSector")}</SubmitButton>
        </form>
      </section>

      {/* Issue 42/43 — Lots: define the numbers, then the draw assigns each to an
          angler (individual) or a pair (pairs). The per-round pattern (fish/control
          + sector) is set per round on the round page. */}
      <section className="card">
        <h2>{t("lots")}</h2>
        <p className="muted">{t("lotsHelp")}</p>
        {lotList.length === 0 && <p className="muted">{t("noLots")}</p>}
        {lotList.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t("thLot")}</th>
                <th>{c.type === "pairs" ? t("thPair") : t("thAngler")}</th>
                <th>{t("thDraw")}</th>
              </tr>
            </thead>
            <tbody>
              {lotList.map((l) => (
                <tr key={l.id}>
                  <td>#{l.number}</td>
                  <td>
                    {c.type === "pairs"
                      ? (l.pair_id ? pairLabelById.get(l.pair_id) ?? "?" : <span className="muted">{t("unassigned")}</span>)
                      : (l.angler_id ? anglerName.get(l.angler_id) ?? "?" : <span className="muted">{t("unassigned")}</span>)}
                  </td>
                  <td>
                    {c.type === "pairs" ? (
                      <form action={assignLotPair} style={{ display: "flex", gap: "0.35rem" }}>
                        <input type="hidden" name="competition_id" value={id} />
                        <input type="hidden" name="lot_id" value={l.id} />
                        <select name="pair_id" defaultValue={l.pair_id ?? ""}>
                          <option value="">{t("unassigned")}</option>
                          {pairList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {pairName(p)}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className="tab" pendingLabel={t("working")}>{t("draw")}</SubmitButton>
                      </form>
                    ) : (
                      <form action={assignLotAngler} style={{ display: "flex", gap: "0.35rem" }}>
                        <input type="hidden" name="competition_id" value={id} />
                        <input type="hidden" name="lot_id" value={l.id} />
                        <select name="angler_id" defaultValue={l.angler_id ?? ""}>
                          <option value="">{t("unassigned")}</option>
                          {anglerList.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton className="tab" pendingLabel={t("working")}>{t("draw")}</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={createLot} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <input type="hidden" name="competition_id" value={id} />
          <input name="number" type="number" min={1} placeholder={t("lotNumber")} required style={{ width: 100 }} />
          <SubmitButton pendingLabel={t("working")}>{t("createLot")}</SubmitButton>
        </form>
      </section>

      {/* Issue 51 — Rotation matrix: per lot × round, the role (fish/control) and
          sector. Define the whole pattern in one view instead of round by round. */}
      <section className="card">
        <h2>{t("rotationHeading")}</h2>
        <p className="muted">{t("rotationHelp")}</p>
        {lotList.length === 0 || roundList.length === 0 || sectorList.length === 0 ? (
          <p className="muted">{t("rotationNeedsData")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("thLot")}</th>
                  {roundList.map((r) => (
                    <th key={r.id}>{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lotList.map((l) => (
                  <tr key={l.id}>
                    <td>#{l.number}</td>
                    {roundList.map((r) => {
                      const entry = entryByCell.get(`${r.id}:${l.id}`);
                      return (
                        <td key={r.id}>
                          <form action={addEntry} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <input type="hidden" name="competition_id" value={id} />
                            <input type="hidden" name="round_id" value={r.id} />
                            <input type="hidden" name="lot_id" value={l.id} />
                            <select name="role" defaultValue={entry?.role ?? "fish"}>
                              <option value="fish">{t("roleFish")}</option>
                              <option value="control">{t("roleControl")}</option>
                            </select>
                            <select name="sector_id" defaultValue={entry?.sector_id ?? ""} required>
                              <option value="">{t("sectorPlaceholderShort")}</option>
                              {sectorList.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {sectorLabel(s)}
                                </option>
                              ))}
                            </select>
                            <SubmitButton className="tab" pendingLabel="…">
                              {t("rotationSave")}
                            </SubmitButton>
                          </form>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
          <PairForm
            competitionId={id}
            anglers={anglerList.map((a) => ({ id: a.id, name: a.name }))}
            labels={{
              angler1: t("angler1"),
              angler2: t("angler2"),
              namePlaceholder: t("pairNamePlaceholder"),
              create: t("createPair"),
              fromRoster: t("pairFromRoster"),
              newAngler: t("pairNewAngler"),
              newName: t("anglerName"),
              newLicense: t("licenseNumber"),
            }}
          />
        </section>
      )}

      {/* Issue 33 — delete the competition (destructive; explicit confirmation). */}
      <section className="card">
        <h2>{t("deleteCompetition")}</h2>
        <form action={deleteCompetition} style={{ display: "grid", gap: "0.5rem" }}>
          <input type="hidden" name="competition_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <p className="muted" style={{ margin: 0 }}>{t("deleteCompetitionHelp")}</p>
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            <input type="checkbox" name="confirm" required style={{ marginRight: 6 }} />
            {t("confirmDeleteCompetition")}
          </label>
          <SubmitButton className="tab" pendingLabel={t("working")} style={{ color: "var(--danger, #c0392b)", width: "fit-content" }}>
            {t("deleteCompetition")}
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
