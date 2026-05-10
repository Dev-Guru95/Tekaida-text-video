/**
 * Start a Stripe Checkout session for a credit pack.
 *   POST /api/build/billing/checkout  { packSlug }
 *
 * If Stripe isn't configured, we return 503 with a helpful message — the
 * Billing tab in the workspace surfaces this so the user can see why the
 * top-up button is disabled instead of getting a silent failure.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findCreditPack } from "@/lib/build/credits";
import { createCheckoutSession, isStripeConfigured } from "@/lib/build/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing not configured: set STRIPE_SECRET_KEY in the server env." },
      { status: 503 },
    );
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { packSlug?: string } | null;
  if (!body?.packSlug) return NextResponse.json({ error: "packSlug required" }, { status: 400 });

  const pack = findCreditPack(body.packSlug);
  if (!pack) return NextResponse.json({ error: "unknown pack" }, { status: 400 });

  const origin = new URL(req.url).origin;
  try {
    const session = await createCheckoutSession({
      successUrl: `${origin}/build?topup=success`,
      cancelUrl: `${origin}/build?topup=canceled`,
      customerEmail: userData.user.email ?? undefined,
      clientReferenceId: userData.user.id,
      packSlug: pack.slug,
      packLabel: pack.label,
      credits: pack.credits,
      priceUsdCents: pack.priceUsd * 100,
    });
    return NextResponse.json({ url: session.url, id: session.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checkout failed" },
      { status: 500 },
    );
  }
}
