import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { editScorecard, registerScorecardClaim, resolveClaim } from "../../actions";
import { allowsEditing } from "@/domain/round-status";
import type {
  Scorecard,
  Round,
  RoundEntry,
  Lot,
  Angler,
  CatchRow,
  ScorecardPhoto,
  Claim,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface AuditRow {
  id: string;
  action: string;
  author: string;
  details: Record<string, unknown>;
  created_at: string;
}

/**
 * Issue 22 — Scorecard detail & edit. Any scorecard (not just flagged ones) can be
 * opened to see its catches, totals, points, evidence photo, validation issues and
 * audit trail, and corrected — recomputing with the engine and auditing the change.
 * A final round is immutable (RF-11).
 */
export default async function ScorecardDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("scorecard");
  const ts = await getTranslations("status");
  const ti = await getTranslations("issue");

  const supabase = await createSupabaseServerClient();
  const { data: scorecard } = await supabase.from("scorecard").select("*").eq("id", id).single();
  if (!scorecard) notFound();
  const sc = scorecard as Scorecard;

  const [{ data: round }, { data: entry }, { data: catches }, { data: photo }, { data: audit }, { data: claims }] =
    await Promise.all([
      supabase.from("round").select("*").eq("id", sc.round_id).single(),
      supabase.from("round_entry").select("*").eq("id", sc.entry_id).single(),
      supabase.from("catch").select("*").eq("scorecard_id", id).order("seq"),
      supabase.from("scorecard_photo").select("*").eq("scorecard_id", id).maybeSingle(),
      supabase
        .from("audit_log")
        .select("*")
        .eq("entity", "scorecard")
        .eq("entity_id", id)
        .order("created_at"),
      supabase.from("claim").select("*").eq("scorecard_id", id).order("created_at"),
    ]);

  const r = round as Round | null;
  const e = entry as RoundEntry | null;
  const catchList = (catches ?? []) as CatchRow[];
  const auditList = (audit ?? []) as AuditRow[];
  const claimList = (claims ?? []) as Claim[];
  const ph = photo as ScorecardPhoto | null;

  // Resolve the lot's angler and a signed URL for the private evidence photo.
  let anglerName = "?";
  let lotNumber: number | null = null;
  if (e) {
    const { data: lot } = await supabase.from("lot").select("*").eq("id", e.lot_id).single();
    const l = lot as Lot | null;
    if (l) {
      lotNumber = l.number;
      const { data: angler } = await supabase.from("angler").select("*").eq("id", l.angler_id).single();
      anglerName = (angler as Angler | null)?.name ?? "?";
    }
  }

  let photoUrl: string | null = null;
  if (ph) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "scorecards";
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(ph.storage_path, 300);
    photoUrl = signed?.signedUrl ?? null;
  }

  const editable = r ? allowsEditing(r.status) : false;
  const openClaims = claimList.filter((c) => c.status === "open").length;
  const currentSizes = catchList.map((c) => Number(c.size_cm)).join(", ");

  return (
    <main className="container">
      <p className="muted">
        {r && <Link href={`/admin/round/${r.id}`}>{t("backRound")}</Link>}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>
          {lotNumber !== null ? `#${lotNumber} · ` : ""}
          {anglerName}
        </h1>
        <span className={`badge ${sc.status === "flagged" ? "provisional" : "final"}`}>
          {ts(`scorecard.${sc.status}`)}
        </span>
      </div>
      {r && (
        <p className="muted">
          {r.name} · {r.date}
        </p>
      )}

      <section className="card">
        <h2>{t("summary")}</h2>
        <div className="muted">
          {t("points")}: <strong>{sc.catch_points}</strong> · {t("legal")}:{" "}
          {sc.total_legal_catches ?? "—"} · {t("undersized")}: {sc.total_undersized ?? "—"} ·{" "}
          {t("biggest")}: {sc.biggest_catch_cm ? `${sc.biggest_catch_cm} cm` : "—"}
        </div>
        <h3>{t("catches")}</h3>
        {catchList.length === 0 ? (
          <p className="muted">{t("noCatches")}</p>
        ) : (
          <ul>
            {catchList.map((c) => (
              <li key={c.id}>
                {Number(c.size_cm)} cm {c.undersized ? `· ${t("undersizedTag")}` : ""}
              </li>
            ))}
          </ul>
        )}
        {sc.issues.length > 0 && (
          <>
            <h3>{t("issues")}</h3>
            <ul className="muted">
              {sc.issues.map((issue, i) => (
                <li key={i}>⚠️ {ti(issue.code, issue.params)}</li>
              ))}
            </ul>
          </>
        )}
        {openClaims > 0 && (
          <p>
            <span className="badge provisional">{t("openClaims", { count: openClaims })}</span>
          </p>
        )}
      </section>

      {photoUrl && (
        <section className="card">
          <h2>{t("photo")}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt={t("photo")} style={{ maxWidth: "100%", borderRadius: 8 }} />
        </section>
      )}

      <section className="card">
        <h2>{t("edit")}</h2>
        {!editable ? (
          <p className="muted">{t("immutable")}</p>
        ) : (
          <form action={editScorecard} style={{ display: "grid", gap: "0.5rem" }}>
            <input type="hidden" name="scorecard_id" value={id} />
            <input type="hidden" name="round_id" value={sc.round_id} />
            <label className="muted" style={{ fontSize: "0.85rem" }}>
              {t("editSizes")}
              <input name="sizes" defaultValue={currentSizes} style={{ display: "block", width: "100%" }} />
            </label>
            <button className="primary" type="submit">
              {t("saveEdit")}
            </button>
          </form>
        )}
      </section>

      {/* Issue 25 — claims hang off this scorecard. */}
      <section className="card">
        <h2>{t("claims")}</h2>
        {claimList.length === 0 && <p className="muted">{t("noClaims")}</p>}
        {claimList.map((c) => (
          <div key={c.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
            <strong>{c.author}</strong> · <span className="muted">{ts(`claim.${c.status}`)}</span>
            <div>{c.reason}</div>
            {c.status === "open" && (
              <form action={resolveClaim} style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                <input type="hidden" name="claim_id" value={c.id} />
                <input type="hidden" name="round_id" value={sc.round_id} />
                <input type="hidden" name="scorecard_id" value={id} />
                <input name="resolution" placeholder={t("resolution")} />
                <select name="status" defaultValue="resolved">
                  <option value="resolved">{t("resolved")}</option>
                  <option value="rejected">{t("rejected")}</option>
                </select>
                <button className="tab" type="submit">
                  {t("resolved")}
                </button>
              </form>
            )}
            {c.resolution && <div className="muted">→ {c.resolution}</div>}
          </div>
        ))}
        <form action={registerScorecardClaim} style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          <input type="hidden" name="scorecard_id" value={id} />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input name="author" placeholder={t("claimAuthor")} required />
            <input name="reason" placeholder={t("claimReason")} required style={{ flex: 1 }} />
          </div>
          <button className="primary" type="submit">
            {t("submitClaim")}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t("auditTrail")}</h2>
        {auditList.length === 0 && <p className="muted">{t("noAudit")}</p>}
        {auditList.map((a) => (
          <div key={a.id} className="muted" style={{ fontSize: "0.85rem" }}>
            {a.created_at} · {a.action} · {a.author}
            {a.details && Object.keys(a.details).length > 0 && (
              <span> · {JSON.stringify(a.details)}</span>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
