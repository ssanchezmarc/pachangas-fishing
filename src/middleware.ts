/**
 * Combined middleware (issue 14 + PRD §4):
 *  1. next-intl handles locale routing/detection (es default, en prefixed).
 *  2. For /admin paths (in any locale) the Supabase Auth session is checked:
 *     only the authenticated organizers get in, others go to the login.
 */
import createIntlMiddleware from "next-intl/middleware";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  // Resolve the path without the (optional) locale prefix.
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const hasLocalePrefix = (routing.locales as readonly string[]).includes(segments[0] ?? "");
  const locale = hasLocalePrefix ? segments[0] : routing.defaultLocale;
  const rest = "/" + (hasLocalePrefix ? segments.slice(1) : segments).join("/");

  const isAdmin = rest === "/admin" || rest.startsWith("/admin/");
  if (!isAdmin) return response;

  const isLogin = rest.startsWith("/admin/login");
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/admin/login`;
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/admin`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Match everything except API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
