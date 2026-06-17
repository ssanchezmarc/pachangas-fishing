/**
 * Issue 36 — Auth callback for email invitations / confirmations.
 *
 * Supabase sends the invited organizer a link that lands here. We establish the
 * session (exchanging the PKCE `code`, or verifying a `token_hash` for custom email
 * templates) and then send them to `/admin/accept` to set their password.
 *
 * Lives under /api so the middleware (locale + /admin auth gate) leaves it alone.
 */
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/admin";

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/admin/login?error=invite`);
}
