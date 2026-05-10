/**
 * Stripe webhook receiver. Stripe POSTs here when a `checkout.session.completed`
 * event fires; we credit the user's account and write a ledger row.
 *
 * Configure this URL in the Stripe dashboard under Developers → Webhooks. The
 * signing secret goes in STRIPE_WEBHOOK_SECRET.
 *
 * IMPORTANT: this route uses the raw request body (no JSON parse) because
 * Stripe's signature is computed over the bytes Stripe actually sent.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { verifyWebhookSignature } from "@/lib/build/stripe";

export const dynamic = "force-dynamic";

interface CheckoutCompleted {
  type: string;
  data: {
    object: {
      id: string;
      client_reference_id?: string;
      metadata?: { pack?: string; credits?: string; user_id?: string };
    };
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook secret not set" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!verifyWebhookSignature(raw, sig, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const evt = JSON.parse(raw) as CheckoutCompleted;
  if (evt.type !== "checkout.session.completed") {
    return NextResponse.json({ ignored: evt.type });
  }

  const session = evt.data.object;
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const credits = Number(session.metadata?.credits ?? 0);
  if (!userId || !credits || credits <= 0) {
    return NextResponse.json({ error: "missing user_id or credits in metadata" }, { status: 400 });
  }

  const svc = createSupabaseServiceClient();
  if (!svc) return NextResponse.json({ error: "service-role key not set" }, { status: 503 });

  // Idempotency via the unique `external_ref` column. Stripe occasionally
  // re-delivers webhook events; the unique constraint turns a duplicate into
  // a no-op (we ignore the resulting 23505 conflict).
  const { error } = await svc.from("credit_ledger").insert({
    user_id: userId,
    amount: credits,
    reason: "stripe_topup",
    external_ref: session.id,
  });
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
