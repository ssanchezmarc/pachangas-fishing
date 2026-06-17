"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Issue 36 — An invited organizer lands here (after /api/auth/confirm set their
 * session) to set a password on first access. Once set, they are a normal organizer.
 */
export default function AcceptInvitePage() {
  const t = useTranslations("accept");
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>{t("title")}</h1>
      <p className="muted">{email ? t("subtitle", { email }) : t("subtitleNoSession")}</p>
      <form onSubmit={onSubmit} className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          {t("password")}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: "100%" }}
          />
        </label>
        {error && <p style={{ color: "#ff9a9a" }}>{error}</p>}
        <button className="primary" type="submit" disabled={loading || !email}>
          {loading ? t("saving") : t("save")}
        </button>
      </form>
    </main>
  );
}
