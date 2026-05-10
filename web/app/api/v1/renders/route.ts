/**
 * Public API surface — programmatic access for client integrations.
 *   POST /api/v1/renders
 *   Authorization: Bearer tk_live_...
 *
 * Mirrors the body shape of /api/build/jobs (the workspace UI's submit) but
 * authenticates via the api_keys table instead of Supabase session cookies.
 * This is what customers wire into Zapier / their own apps.
 */

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { submit, QueueError } from "@/lib/build/queue";
import type { AspectRatio, ProviderKey, Resolution } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED_PROVIDERS: ProviderKey[] = ["seedance", "gemini", "chatgpt", "higgsfield"];

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Authorization: Bearer <token> required" }, { status: 401 });
  }
  const token = auth.slice(7).trim();
  if (!token.startsWith("tk_live_")) {
    return NextResponse.json({ error: "invalid token format" }, { status: 401 });
  }

  const svc = createSupabaseServiceClient();
  if (!svc) return NextResponse.json({ error: "supabase service not configured" }, { status: 503 });

  const keyHash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: key } = await svc
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (!key || key.revoked_at) {
    return NextResponse.json({ error: "invalid or revoked token" }, { status: 401 });
  }

  // Update last_used_at (best-effort; ignore failure).
  void svc.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  const provider = (body.provider as ProviderKey) ?? "seedance";
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 400 });
  }

  try {
    const result = await submit({
      userId: key.user_id,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      prompt,
      provider,
      aspect: ((body.aspect as AspectRatio) ?? "16:9"),
      duration: Math.max(2, Math.min(30, Number(body.duration ?? 5))),
      resolution: ((body.resolution as Resolution) ?? "720p"),
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
