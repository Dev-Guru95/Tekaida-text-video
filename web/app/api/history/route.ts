/**
 * History API. Returns the signed-in user's recent generations across all
 * output types. RLS on the `generations` table means each user only sees
 * their own rows — we don't have to filter manually.
 *
 * GET  /api/history          → list last 20 generations
 * POST /api/history          → record a new generation { output_type, title, concept, provider, output_url, metadata? }
 * DELETE /api/history?id=... → remove one generation (RLS still enforced)
 *
 * When Supabase isn't configured, all three return `{ enabled: false }` so
 * the UI can hide the history sidebar without erroring.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ enabled: false, items: [] });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ enabled: true, signedIn: false, items: [] });
  }

  const { data, error } = await supabase
    .from("generations")
    .select("id, output_type, title, concept, provider, output_url, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ enabled: true, signedIn: true, items: [], error: error.message });
  }
  return NextResponse.json({ enabled: true, signedIn: true, items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ enabled: false });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ enabled: true, signedIn: false }, { status: 401 });
  }

  const body = (await req.json()) as {
    output_type?: string;
    title?: string;
    concept?: string;
    provider?: string;
    output_url?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.output_type || !body.concept) {
    return NextResponse.json({ error: "output_type and concept are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("generations")
    .insert({
      user_id: userData.user.id,
      output_type: body.output_type,
      title: body.title ?? null,
      concept: body.concept,
      provider: body.provider ?? null,
      output_url: body.output_url ?? null,
      metadata: body.metadata ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ enabled: true, signedIn: true, item: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ enabled: false });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("generations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enabled: true, deleted: id });
}
