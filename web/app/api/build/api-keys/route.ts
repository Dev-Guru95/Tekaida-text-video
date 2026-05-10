/**
 * Programmatic API key management.
 *   GET    /api/build/api-keys         → list user's keys (prefix only — no plaintext)
 *   POST   /api/build/api-keys         → create one. Returns the plaintext token
 *                                        ONCE; we only ever store sha256(token).
 *   DELETE /api/build/api-keys?id=...  → revoke a key
 *
 * Token format: `tk_live_` + 32 random url-safe bytes. Hash on the server with
 * sha256. The plaintext is shown to the user a single time on creation.
 */

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ enabled: false, items: [] });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ enabled: true, signedIn: false, items: [] });

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, prefix, last_used_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ enabled: true, items: [], error: error.message });
  return NextResponse.json({ enabled: true, signedIn: true, items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim() || "default";

  // 32 bytes -> 43 chars base64url. Prefixed with `tk_live_` so it's recognizable.
  const tokenBytes = crypto.randomBytes(32);
  const tokenSecret = tokenBytes.toString("base64url");
  const plaintext = `tk_live_${tokenSecret}`;
  const keyHash = crypto.createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, 12);

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: userData.user.id,
      name,
      key_hash: keyHash,
      prefix,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    prefix,
    plaintext,        // ← shown once; client must store it
    created_at: data.created_at,
    notice: "Copy this token now — it will not be shown again.",
  });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
