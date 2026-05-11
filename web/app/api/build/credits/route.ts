/**
 * Credit balance + recent ledger for the signed-in user.
 *   GET /api/build/credits  →  { balance, lifetime_topup, ledger: [...] }
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CREDIT_PACKS } from "@/lib/build/credits";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({
      enabled: false,
      balance: 0,
      lifetime_topup: 0,
      ledger: [],
      packs: CREDIT_PACKS,
    });
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({
      enabled: true,
      signedIn: false,
      balance: 0,
      lifetime_topup: 0,
      ledger: [],
      packs: CREDIT_PACKS,
    });
  }

  const [{ data: bal }, { data: ledger }, { data: isAdmin }] = await Promise.all([
    supabase.from("credits").select("balance, lifetime_topup").eq("user_id", userData.user.id).maybeSingle(),
    supabase
      .from("credit_ledger")
      .select("id, amount, reason, ref_id, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    // The is_admin SQL function lives in supabase-build-schema.sql. Reads
    // from profiles_admin (which has no SELECT policy), so we can't query
    // the table directly — the SECURITY DEFINER function is the entry point.
    supabase.rpc("is_admin", { uid: userData.user.id }),
  ]);

  return NextResponse.json({
    enabled: true,
    signedIn: true,
    isAdmin: Boolean(isAdmin),
    balance: bal?.balance ?? 0,
    lifetime_topup: bal?.lifetime_topup ?? 0,
    ledger: ledger ?? [],
    packs: CREDIT_PACKS,
  });
}
