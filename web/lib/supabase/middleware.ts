/**
 * Supabase auth-session middleware helper.
 *
 * Runs on every request (via web/middleware.ts) and:
 *   1. Reads the user's auth cookies from the incoming request.
 *   2. Calls supabase.auth.getUser() which transparently refreshes the
 *      access token if it's near expiry. Without this, a session that's
 *      still technically valid (refresh token alive, access token close
 *      to expiry) would look signed-out by the next route handler.
 *   3. Writes the refreshed cookies onto the outgoing response so the
 *      browser receives the updated tokens.
 *
 * This is the canonical pattern from the Supabase SSR docs. The catch is
 * that we have to forward the cookies onto BOTH the request (so server-
 * side reads later in the chain see them) AND the response (so the
 * browser stores them).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./config";

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const env = supabaseEnv();
  if (!env) {
    // Anonymous-mode deploys: nothing to refresh.
    return supabaseResponse;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: do NOT remove the await — `getUser()` is what triggers the
  // refresh. Removing or reordering this turns this middleware into a no-op.
  await supabase.auth.getUser();

  return supabaseResponse;
}
