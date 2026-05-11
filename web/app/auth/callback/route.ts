/**
 * Supabase email callback. The confirmation/magic-link email Supabase sends
 * eventually redirects the user here. Two flows show up depending on the
 * Supabase project setting:
 *
 *   - PKCE (`?code=...`)         — issued when `signUp` was called from a
 *                                  browser that had supabase-js loaded. The
 *                                  exchange requires the original code-verifier
 *                                  cookie, so it only works if the email is
 *                                  opened in the same browser session.
 *
 *   - OTP   (`?token_hash=...&type=signup|magiclink|recovery|email_change`)
 *                                — stateless. Works even when the user opens
 *                                  the email on a different device. We fall
 *                                  back to this whenever there's no `code`.
 *
 * Errors from Supabase show up as `?error=...&error_description=...` on the
 * redirect. We forward those to the destination page as query params so the
 * UI can surface them — silent failures were how a broken signup confirmation
 * looked indistinguishable from "user opened the link before confirming".
 */

import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabaseError = url.searchParams.get("error");
  const supabaseErrorDesc = url.searchParams.get("error_description");
  const next = url.searchParams.get("next") || "/build";

  // On Render (and most reverse proxies) `request.url` reflects the *internal*
  // hop — e.g. `http://localhost:10000/auth/callback` — not the public host.
  // Reconstruct the public origin from the X-Forwarded-* headers Render sets,
  // otherwise we'd redirect the user to localhost after sign-in.
  const h = await headers();
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host") ?? url.host;
  const forwardedProto = h.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = `${forwardedProto}://${forwardedHost}`;

  // Build a redirect URL we can append error info to.
  const buildRedirect = (path: string, params?: Record<string, string>) => {
    const target = new URL(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => v && target.searchParams.set(k, v));
    }
    return NextResponse.redirect(target.toString());
  };

  // Supabase pre-empted us — forward the error.
  if (supabaseError) {
    return buildRedirect(next, {
      auth_error: supabaseError,
      auth_error_description: supabaseErrorDesc ?? "",
    });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return buildRedirect(next, {
      auth_error: "supabase_not_configured",
      auth_error_description: "Supabase env vars are missing on the server.",
    });
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return buildRedirect(next, {
        auth_error: "exchange_failed",
        auth_error_description:
          error.message +
          " — try opening the confirmation email in the same browser you signed up from.",
      });
    }
  } else if (tokenHash && type) {
    // OTP fallback for cross-device email opens.
    const otpType = (ALLOWED_OTP_TYPES as string[]).includes(type)
      ? (type as EmailOtpType)
      : "magiclink";
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error) {
      return buildRedirect(next, {
        auth_error: "verify_failed",
        auth_error_description: error.message,
      });
    }
  } else {
    // No code, no token — link was malformed or already used.
    return buildRedirect(next, {
      auth_error: "missing_token",
      auth_error_description:
        "The confirmation link didn't include an auth token. Try signing up again.",
    });
  }

  return buildRedirect(next);
}
