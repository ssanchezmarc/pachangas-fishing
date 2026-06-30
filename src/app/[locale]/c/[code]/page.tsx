import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { resolveCompetitionByCode } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Issue 45 — Access a private competition by its code: organizers hand out a link
 * like /c/{code}. We resolve the code to its competition and forward to the
 * standings page carrying the code (so the private gate lets it through). Unknown
 * codes 404.
 */
export default async function CodeAccessPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const id = await resolveCompetitionByCode(code);
  if (!id) notFound();
  redirect({ href: { pathname: `/competition/${id}`, query: { code } }, locale });
}
