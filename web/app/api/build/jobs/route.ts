/**
 * Render-job API.
 *   POST /api/build/jobs   → submit a new render job
 *   GET  /api/build/jobs   → list the signed-in user's jobs (most recent first)
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { submit, QueueError } from "@/lib/build/queue";
import type { AspectRatio, ProviderKey, Resolution } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // submit returns fast; rendering happens via runJob

const ALLOWED_PROVIDERS: ProviderKey[] = ["seedance", "gemini", "chatgpt", "higgsfield"];
const ALLOWED_ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "9:21"];
const ALLOWED_RES: Resolution[] = ["480p", "720p", "1080p"];

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Sign in to render videos." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const provider = (body.provider as ProviderKey) ?? "seedance";
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 400 });
  }
  const aspect = (body.aspect as AspectRatio) ?? "16:9";
  if (!ALLOWED_ASPECTS.includes(aspect)) {
    return NextResponse.json({ error: `unknown aspect: ${aspect}` }, { status: 400 });
  }
  const resolution = (body.resolution as Resolution) ?? "720p";
  if (!ALLOWED_RES.includes(resolution)) {
    return NextResponse.json({ error: `unknown resolution: ${resolution}` }, { status: 400 });
  }
  const duration = Math.max(2, Math.min(30, Number(body.duration ?? 5)));

  try {
    const result = await submit({
      userId: userData.user.id,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      prompt,
      provider,
      aspect,
      duration,
      resolution,
      cameraSlug: typeof body.cameraSlug === "string" ? body.cameraSlug : null,
      motionSlug: typeof body.motionSlug === "string" ? body.motionSlug : null,
      styleSlug: typeof body.styleSlug === "string" ? body.styleSlug : null,
      characterDescriptor:
        typeof body.characterDescriptor === "string" ? body.characterDescriptor : null,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof QueueError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "submit failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ enabled: false, items: [] });
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ enabled: true, signedIn: false, items: [] });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  let q = supabase
    .from("render_jobs")
    .select("id, status, provider, prompt, output_url, thumbnail_url, duration, credits_cost, progress, error, created_at, finished_at, params")
    .order("created_at", { ascending: false })
    .limit(40);

  if (projectId) q = q.eq("project_id", projectId);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ enabled: true, signedIn: true, items: [], error: error.message });
  }
  return NextResponse.json({ enabled: true, signedIn: true, items: data ?? [] });
}
