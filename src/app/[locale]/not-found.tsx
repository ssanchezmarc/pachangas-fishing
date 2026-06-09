import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main className="container">
      <h1>{t("title")}</h1>
      <p className="muted">{t("body")}</p>
      <Link href="/">{t("back")}</Link>
    </main>
  );
}
