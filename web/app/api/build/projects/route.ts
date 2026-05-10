/**
 * Projects API. RLS enforces ownership/membership server-side.
 *   GET   /api/build/projects        → list projects user owns or is a member of
 *   POST  /api/build/projects        → create a project { name, description? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ enabled: false, items: [] });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ enabled: true, signedIn: false, items: [] });

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, description, cover_url, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ enabled: true, items: [], error: error.message });
  return NextResponse.json({ enabled: true, signedIn: true, items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { name?: string; description?: string }
    | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: userData.user.id,
      name,
      description: body?.description?.trim() ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Owner is implicitly an editor. Insert membership row so team queries
  // include the owner without special-casing them downstream.
  await supabase.from("project_members").insert({
    project_id: data.id,
    user_id: userData.user.id,
    role: "owner",
  });

  return NextResponse.json({ project: data });
}
