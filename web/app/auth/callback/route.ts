/**
 * Supabase magic-link callback. The email Supabase sends contains a link
 * back to this route with `?code=...`; we exchange the code for a session
 * and redirect to the app.
 */

import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  // On Render (and most reverse proxies) `request.url` reflects the *internal*
  // hop — e.g. `http://localhost:10000/auth/callback` — not the public host.
  // Reconstruct the public origin from the X-Forwarded-* headers Render sets,
  // otherwise we'd redirect the user to localhost after sign-in.
  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host") ?? url.host;
  const forwardedProto =
    h.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${forwardedProto}://${forwardedHost}`;

  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  }
  return NextResponse.redirect(`${origin}${next}`);
}
