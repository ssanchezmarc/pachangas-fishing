import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  confirmScorecard,
  correctScorecard,
  createScorecardManual,
  createSector,
  addEntry,
  processScorecardReading,
  transitionRound,
  updateRound,
  deleteRound,
  setRoundWhatsappActive,
} from "../../actions";
import { possibleTransitions, allowsEditing } from "@/domain/round-status";
import type { RoundEntry, Round, Angler, Scorecard, Sector, Lot, Claim } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AdminRoundPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("adminRound");
  const ts = await getTranslations("status");
  const ti = await getTranslations("issue");

  const supabase = await createSupabaseServerClient();

  const { data: round } = await supabase.from("round").select("*").eq("id", id).single();
  if (!round) notFound();
  const r = round as Round;

  const [
    { data: sectors },
    { data: entries },
    { data: anglers },
    { data: scorecards },
    { data: claims },
    { data: lots },
  ] = await Promise.all([
    supabase.from("sector").select("*").eq("round_id", id).order("name"),
    supabase.from("round_entry").select("*").eq("round_id", id),
    supabase.from("angler").select("*").eq("competition_id", r.competition_id).order("name"),
    supabase.from("scorecard").select("*").eq("round_id", id),
    supabase.from("claim").select("*").eq("round_id", id).order("created_at"),
    supabase.from("lot").select("*").eq("competition_id", r.competition_id).order("number"),
  ]);

  const secs = (sectors ?? []) as Sector[];
  const entryList = (entries ?? []) as RoundEntry[];
  const anglerList = (anglers ?? []) as Angler[];
  const scorecardList = (scorecards ?? []) as Scorecard[];
  const claimList = (claims ?? []) as Claim[];
  const lotList = (lots ?? []) as Lot[];

  const scorecardByEntry = new Map(scorecardList.map((s) => [s.entry_id, s]));
  // Open-claim count per scorecard (issue 25): flag plicas with pending claims.
  const openClaimsByScorecard = new Map<string, number>();
  for (const c of claimList) {
    if (c.status === "open") {
      openClaimsByScorecard.set(c.scorecard_id, (openClaimsByScorecard.get(c.scorecard_id) ?? 0) + 1);
    }
  }
  const anglerNameById = new Map(anglerList.map((a) => [a.id, a.name]));
  const sectorNameById = new Map(secs.map((s) => [s.id, s.name]));
  const entryById = new Map(entryList.map((e) => [e.id, e]));
  const lotById = new Map(lotList.map((l) => [l.id, l]));
  // Derive the angler / lot label of a round_entry through its lot (issue 20).
  const lotLabel = (lotId: string | null) => {
    if (!lotId) return "—";
    const lot = lotById.get(lotId);
    if (!lot) return "?";
    return `#${lot.number} · ${anglerNameById.get(lot.angler_id) ?? "?"}`;
  };
  const entryAngler = (e: RoundEntry) => {
    const lot = lotById.get(e.lot_id);
    return lot ? (anglerNameById.get(lot.angler_id) ?? "?") : "?";
  };
  // Lots not yet entered in this round (available to add to the roster).
  const enteredLotIds = new Set(entryList.map((e) => e.lot_id));
  const availableLots = lotList.filter((l) => !enteredLotIds.has(l.id));
  const flagged = scorecardList.filter((s) => s.status === "flagged");

  return (
    <main className="container">
      <p className="muted">
        <Link href="/admin">{t("organizers")}</Link> ·{" "}
        <Link href={`/admin/competition/${r.competition_id}`}>{t("backCompetition")}</Link> ·{" "}
        <Link href={`/round/${id}`}>{t("viewPublic")}</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>{r.name}</h1>
        <span className={`badge ${r.status}`}>{ts(`round.${r.status}`)}</span>
      </div>
      <p className="muted">{r.date}</p>

      {/* Slice 12 — state machine */}
      <section className="card">
        <h2>{t("standingsStatus")}</h2>
        <p className="muted">{t("statusFlow")}</p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {possibleTransitions(r.status).length === 0 && (
            <span className="muted">{t("finalImmutable")}</span>
          )}
          {possibleTransitions(r.status).map((to) => (
            <form key={to} action={transitionRound}>
              <input type="hidden" name="round_id" value={id} />
              <input type="hidden" name="to" value={to} />
              <button className="primary" type="submit">
                {to === "provisional" ? t("publishProvisional") : t("publishFinal")}
              </button>
            </form>
          ))}
        </div>
      </section>

      {/* Issue 10 — mark this round as the one receiving inbound WhatsApp photos. */}
      <section className="card">
        <h2>{t("whatsappTitle")}</h2>
        <p className="muted">{t("whatsappHelp")}</p>
        <p>
          <span className={`badge ${r.whatsapp_active ? "open" : ""}`}>
            {r.whatsapp_active ? t("whatsappOn") : t("whatsappOff")}
          </span>
        </p>
        <form action={setRoundWhatsappActive}>
          <input type="hidden" name="round_id" value={id} />
          <input type="hidden" name="competition_id" value={r.competition_id} />
          <input type="hidden" name="active" value={r.whatsapp_active ? "false" : "true"} />
          <button className={r.whatsapp_active ? "tab" : "primary"} type="submit">
            {r.whatsapp_active ? t("whatsappDeactivate") : t("whatsappActivate")}
          </button>
        </form>
      </section>

      {/* Issue 32 — edit / delete the round. A final round is immutable (RF-11). */}
      <section className="card">
        <h2>{t("editRound")}</h2>
        {!allowsEditing(r.status) ? (
          <p className="muted">{t("finalLocked")}</p>
        ) : (
          <>
            <form action={updateRound} style={{ display: "grid", gap: "0.5rem" }}>
              <input type="hidden" name="round_id" value={id} />
              <input type="hidden" name="competition_id" value={r.competition_id} />
              <input name="name" defaultValue={r.name} placeholder={t("roundName")} required />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input name="date" type="date" defaultValue={r.date} required />
                <input name="start_time" type="time" defaultValue={r.start_time?.slice(0, 5) ?? ""} />
                <input name="end_time" type="time" defaultValue={r.end_time?.slice(0, 5) ?? ""} />
                <input
                  name="group_index"
                  type="number"
                  min={1}
                  defaultValue={r.group_index ?? ""}
                  placeholder={t("phase")}
                  style={{ width: 110 }}
                />
              </div>
              <button className="primary" type="submit">
                {t("saveRound")}
              </button>
            </form>
            <form
              action={deleteRound}
              style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", display: "grid", gap: "0.5rem" }}
            >
              <input type="hidden" name="round_id" value={id} />
              <input type="hidden" name="competition_id" value={r.competition_id} />
              <input type="hidden" name="locale" value={locale} />
              <p className="muted" style={{ margin: 0 }}>{t("deleteRoundHelp")}</p>
              <label className="muted" style={{ fontSize: "0.85rem" }}>
                <input type="checkbox" name="confirm" required style={{ marginRight: 6 }} />
                {t("confirmDeleteRound")}
              </label>
              <button className="tab" type="submit" style={{ color: "var(--danger, #c0392b)", width: "fit-content" }}>
                {t("deleteRound")}
              </button>
            </form>
          </>
        )}
      </section>

      {/* Slice 09 — HITL queue */}
      {flagged.length > 0 && (
        <section className="card">
          <h2>{t("reviewQueue", { count: flagged.length })}</h2>
          {flagged.map((s) => {
            const entry = entryById.get(s.entry_id);
            return (
              <div key={s.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                <strong>{entry ? lotLabel(entry.lot_id) : "?"}</strong>
                <ul className="muted">
                  {s.issues.map((issue, i) => (
                    <li key={i}>⚠️ {ti(issue.code, issue.params)}</li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
                  <form action={confirmScorecard}>
                    <input type="hidden" name="scorecard_id" value={s.id} />
                    <input type="hidden" name="round_id" value={id} />
                    <button className="tab" type="submit">
                      {t("confirmAsIs")}
                    </button>
                  </form>
                  <form action={correctScorecard} style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
                    <input type="hidden" name="scorecard_id" value={s.id} />
                    <input type="hidden" name="round_id" value={id} />
                    <label className="muted" style={{ fontSize: "0.8rem" }}>
                      {t("correctSizes")}
                      <input name="sizes" placeholder="20, 23, 18" style={{ display: "block" }} />
                    </label>
                    <button className="primary" type="submit">
                      {t("correct")}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card">
        <h2>{t("sectors")}</h2>
        {secs.map((s) => (
          <span key={s.id} className="badge open" style={{ marginRight: 6 }}>
            {s.name}
          </span>
        ))}
        <form action={createSector} style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <input type="hidden" name="round_id" value={id} />
          <input name="name" placeholder={t("newSector")} required />
          <button className="primary" type="submit">
            {t("addSector")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("roster")}</h2>
        <p className="muted">{t("rosterHelp")}</p>
        {entryList.length === 0 && <p className="muted">{t("noEntries")}</p>}
        {entryList.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t("thLot")}</th>
                <th>{t("thAngler")}</th>
                <th>{t("thSector")}</th>
                <th>{t("thControls")}</th>
                <th>{t("thScorecard")}</th>
              </tr>
            </thead>
            <tbody>
              {entryList.map((e) => {
                const scorecard = scorecardByEntry.get(e.id);
                const lot = lotById.get(e.lot_id);
                return (
                  <tr key={e.id}>
                    <td>{lot ? `#${lot.number}` : "?"}</td>
                    <td>{entryAngler(e)}</td>
                    <td>{sectorNameById.get(e.sector_id) ?? "?"}</td>
                    <td>{lotLabel(e.controls_lot_id)}</td>
                    <td>
                      {scorecard ? (
                        <Link href={`/admin/scorecard/${scorecard.id}`}>
                          <span className={`badge ${scorecard.status === "flagged" ? "provisional" : "final"}`}>
                            {ts(`scorecard.${scorecard.status}`)} · {scorecard.catch_points} {t("pts")}
                          </span>
                          {openClaimsByScorecard.get(scorecard.id) ? (
                            <span className="badge provisional" style={{ marginLeft: 4 }}>
                              ⚠ {openClaimsByScorecard.get(scorecard.id)}
                            </span>
                          ) : null}
                        </Link>
                      ) : (
                        <span className="muted">{t("noScorecard")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <form action={addEntry} style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
          <input type="hidden" name="round_id" value={id} />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select name="lot_id" required>
              <option value="">{t("lotPlaceholder")}</option>
              {availableLots.map((l) => (
                <option key={l.id} value={l.id}>
                  #{l.number} · {anglerNameById.get(l.angler_id) ?? "?"}
                </option>
              ))}
            </select>
            <select name="sector_id" required>
              <option value="">{t("sectorPlaceholder")}</option>
              {secs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select name="controls_lot_id">
              <option value="">{t("controlsOptional")}</option>
              {lotList.map((l) => (
                <option key={l.id} value={l.id}>
                  #{l.number} · {anglerNameById.get(l.angler_id) ?? "?"}
                </option>
              ))}
            </select>
          </div>
          <button className="primary" type="submit">
            {t("addEntry")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("scorecardEntry")}</h2>
        <p className="muted">{t("scorecardHelpReal")}</p>
        {/* Issue 23/24 — real plica format: photo first, then lot + controller +
            measures (size → quantity) + undersized count. The roster entry is
            created on the fly, so no prior registration is needed. */}
        <form action={createScorecardManual} style={{ display: "grid", gap: "0.5rem" }}>
          <input type="hidden" name="round_id" value={id} />
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            {t("photoLabel")}
            <input name="photo" type="file" accept="image/*" style={{ display: "block", marginTop: 4 }} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select name="lot_id" required>
              <option value="">{t("lotAnglerPlaceholder")}</option>
              {lotList.map((l) => (
                <option key={l.id} value={l.id}>
                  #{l.number} · {anglerNameById.get(l.angler_id) ?? "?"}
                </option>
              ))}
            </select>
            <select name="sector_id" required>
              <option value="">{t("sectorPlaceholder")}</option>
              {secs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select name="controls_lot_id">
              <option value="">{t("controlsOptional")}</option>
              {lotList.map((l) => (
                <option key={l.id} value={l.id}>
                  #{l.number} · {anglerNameById.get(l.angler_id) ?? "?"}
                </option>
              ))}
            </select>
          </div>
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            {t("measuresLabel")}
            <textarea name="measures" rows={4} placeholder={"21 3\n26 1\n24 2"} style={{ display: "block", width: "100%" }} />
          </label>
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            {t("undersizedLabel")}
            <input name="undersized" type="number" min={0} defaultValue={0} style={{ display: "block", width: 120 }} />
          </label>
          <button className="primary" type="submit">
            {t("saveManual")}
          </button>
        </form>
        <form action={processScorecardReading} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input type="hidden" name="round_id" value={id} />
          <select name="entry_id" required>
            <option value="">{t("lotAnglerPlaceholder")}</option>
            {entryList.map((e) => (
              <option key={e.id} value={e.id}>
                {lotLabel(e.lot_id)}
              </option>
            ))}
          </select>
          <button className="tab" type="submit">
            {t("processAIReading")}
          </button>
        </form>
      </section>

      {/* Issue 25 — claims are now managed per scorecard (open its detail). The
          Plicas table above flags any scorecard with open claims. */}
      {claimList.length > 0 && (
        <section className="card">
          <h2>{t("claims")}</h2>
          {claimList.map((c) => (
            <div key={c.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
              <Link href={`/admin/scorecard/${c.scorecard_id}`}>
                <strong>{c.author}</strong>
              </Link>{" "}
              · <span className="muted">{ts(`claim.${c.status}`)}</span>
              <div>{c.reason}</div>
              {c.resolution && <div className="muted">→ {c.resolution}</div>}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
