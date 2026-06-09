"use client";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Language switcher. Navigates to the same path in the chosen locale; next-intl
 * persists the choice via the NEXT_LOCALE cookie.
 */
export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <label className="lang-switcher" aria-label={t("label")}>
      <select
        value={locale}
        onChange={(e) => router.replace(pathname, { locale: e.target.value })}
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
