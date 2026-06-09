import { defineRouting } from "next-intl/routing";

/**
 * i18n routing config (issue 14). Spanish is the default (the audience is a
 * Spanish fishing club); English is also shipped. The codebase stays in English.
 *
 * `localePrefix: 'as-needed'` keeps default-locale URLs prefix-free
 * (`/round/x` = Spanish) and prefixes the others (`/en/round/x` = English), so
 * existing bookmarks keep working.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
