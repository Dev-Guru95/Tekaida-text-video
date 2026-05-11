/**
 * Admin dashboard data. Gated by the `profiles_admin` allow-list (see
 * supabase-build-schema.sql). Returns aggregates the operator needs:
 *   - queue depth (queued/processing/done/error counts in last 24h)
 *   - top users by spend
 *   - recent failed jobs (for triage)
 *
 * Uses the service-role client because we need cross-user reads. The first
 * thing we do is verify the caller is on the allow-list — without that, any
 * authenticated user could see global aggregates.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { monthlyBudgetCents } from "@/lib/build/provider-costs";
import type { ProviderKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: isAdmin } = await supabase.rpc("is_admin", { uid: userData.user.id });
  if (!isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const svc = createSupabaseServiceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Service-role key not set; admin endpoints require SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const [
    { count: queued },
    { count: processing },
    { count: done24h },
    { count: errors24h },
    { data: recentErrors },
    { data: topSpenders },
    { data: spendRows },
  ] = await Promise.all([
    svc.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    svc.from("render_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    svc
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "done")
      .gte("created_at", since),
    svc
      .from("render_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "error")
      .gte("created_at", since),
    svc
      .from("render_jobs")
      .select("id, user_id, provider, error, created_at")
      .eq("status", "error")
      .order("created_at", { ascending: false })
      .limit(10),
    svc
      .from("credits")
      .select("user_id, lifetime_topup, balance")
      .order("lifetime_topup", { ascending: false })
      .limit(10),
    svc.from("provider_spend_this_month").select("provider, spent_cents, render_count"),
  ]);

  // Pair each provider's current-month spend with the configured budget so
  // the UI can render a single bar per provider.
  const providers: ProviderKey[] = ["seedance", "higgsfield", "gemini", "chatgpt"];
  const spendByProvider = new Map<string, { spent_cents: number; render_count: number }>();
  for (const row of spendRows ?? []) {
    spendByProvider.set(row.provider, {
      spent_cents: Number(row.spent_cents ?? 0),
      render_count: Number(row.render_count ?? 0),
    });
  }
  const spend = providers.map((p) => {
    const row = spendByProvider.get(p) ?? { spent_cents: 0, render_count: 0 };
    const budget_cents = monthlyBudgetCents(p);
    return {
      provider: p,
      spent_cents: row.spent_cents,
      budget_cents,
      pct: budget_cents > 0 ? Math.min(100, Math.round((row.spent_cents / budget_cents) * 100)) : 0,
      render_count: row.render_count,
    };
  });

  return NextResponse.json({
    queue: {
      queued: queued ?? 0,
      processing: processing ?? 0,
      done24h: done24h ?? 0,
      errors24h: errors24h ?? 0,
    },
    recentErrors: recentErrors ?? [],
    topSpenders: topSpenders ?? [],
    spend,
  });
}
