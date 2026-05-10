/**
 * Tiny Stripe REST wrapper so we don't pull the full `stripe` package into
 * the deploy bundle. Only the two calls we actually need:
 *   - createCheckoutSession  → POST /v1/checkout/sessions
 *   - constructWebhookEvent  → SHA-256 HMAC verification of webhook signatures
 *
 * If STRIPE_SECRET_KEY is not set, callers should fall back to a "billing not
 * configured" response (we don't throw at module load).
 */

import crypto from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

interface CheckoutSession {
  id: string;
  url: string;
}

export async function createCheckoutSession(opts: {
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  clientReferenceId: string;       // user_id
  packSlug: string;
  packLabel: string;
  credits: number;
  priceUsdCents: number;
}): Promise<CheckoutSession> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", opts.successUrl);
  form.set("cancel_url", opts.cancelUrl);
  form.set("client_reference_id", opts.clientReferenceId);
  if (opts.customerEmail) form.set("customer_email", opts.customerEmail);

  // line_items[0]
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(opts.priceUsdCents));
  form.set(
    "line_items[0][price_data][product_data][name]",
    `Tekaida Build — ${opts.packLabel} pack`,
  );
  form.set(
    "line_items[0][price_data][product_data][description]",
    `${opts.credits} credits`,
  );

  form.set("metadata[pack]", opts.packSlug);
  form.set("metadata[credits]", String(opts.credits));
  form.set("metadata[user_id]", opts.clientReferenceId);

  const r = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = (await r.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!r.ok || !json.id || !json.url) {
    throw new Error(json.error?.message ?? `stripe checkout failed: HTTP ${r.status}`);
  }
  return { id: json.id, url: json.url };
}

/**
 * Verify a Stripe webhook signature. Stripe signs using HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, with the secret prefixed `whsec_`. We accept the
 * default 5-minute tolerance window.
 */
export function verifyWebhookSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!sigHeader) return false;
  const parts = sigHeader.split(",").reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");

  // Constant-time compare
  if (expected.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
