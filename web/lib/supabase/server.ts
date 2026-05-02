/**
 * Supabase client for Server Components / Route Handlers / Server Actions.
 * Reads the user's auth cookies via Next.js `cookies()` so RLS policies
 * resolve `auth.uid()` correctly server-side.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./config";

export async function createSupabaseServerClient() {
  const env = supabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll throws when called from Server Components — safe to ignore
          // because middleware (or the auth callback route) refreshes cookies.
        }
      },
    },
  });
}
