/**
 * Integration-test helpers for the local Supabase stack.
 *
 * These power the DB-backed smoke (#01) and multi-club RLS (#29) tests. They run
 * ONLY against a local Supabase (127.0.0.1/localhost) so `vitest run` in CI —
 * where there is no `.env.local` and no database — simply skips them via
 * `dbEnvReady`. Never point these at a cloud project: the suites create and
 * delete users, clubs and competitions.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// vitest (unlike Next.js) does not load `.env.local`, so do it here, without
// clobbering anything already set in the environment.
function loadEnvLocal(): void {
  try {
    const path = fileURLToPath(new URL("../../.env.local", import.meta.url));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // No .env.local (CI): the suites that depend on it will skip.
  }
}
loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Guard: only run against a LOCAL Supabase, never a cloud project. */
const isLocal = /127\.0\.0\.1|localhost/.test(URL_);
export const dbEnvReady = Boolean(URL_ && ANON && SERVICE && isLocal);

/** Service-role client (bypasses RLS) — for arranging fixtures and cleanup. */
export function serviceClient(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false } });
}

/** Anonymous client — the public web's view (no session). */
export function anonClient(): SupabaseClient {
  return createClient(URL_, ANON, { auth: { persistSession: false } });
}

/** Client acting as a signed-in organizer (carries auth.uid() for RLS). */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Creates a confirmed auth user and returns its id + a signed-in access token. */
export async function createOrganizer(
  email: string,
  password: string,
): Promise<{ id: string; accessToken: string }> {
  const svc = serviceClient();
  // Clean any leftover from a previous interrupted run with the same email.
  const { data: list } = await svc.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === email);
  if (existing) await svc.auth.admin.deleteUser(existing.id);

  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(error?.message ?? "createUser failed");

  const { data: session, error: signInErr } = await anonClient().auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session.session) throw new Error(signInErr?.message ?? "signIn failed");
  return { id: created.user.id, accessToken: session.session.access_token };
}

/** Deletes an auth user (ignores errors so cleanup never fails a suite). */
export async function deleteOrganizer(id: string): Promise<void> {
  try {
    await serviceClient().auth.admin.deleteUser(id);
  } catch {
    /* best-effort */
  }
}
