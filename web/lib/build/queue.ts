/**
 * Render queue. Backed by the `render_jobs` table in Supabase — no Redis/BullMQ
 * dependency, but the API surface is small enough to swap to BullMQ later
 * without touching the route handlers (just reimplement `submit` + `runJob`
 * to push to a queue and consume in a separate worker).
 *
 * Lifecycle:
 *   submit()     -> inserts a row in 'queued', debits credits up-front,
 *                   fires runJob() (fire-and-forget — worker runs in the same
 *                   server process; on Vercel each invocation gets up to
 *                   maxDuration seconds, set to 800 on the route).
 *   runJob()     -> flips the row to 'processing', calls the provider,
 *                   downloads the resulting MP4 to /public/output, writes
 *                   the public URL back to the row, sets status='done'.
 *   onFailure    -> writes status='error', refunds the credit hold.
 */

import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { estimateCreditsCost } from "./credits";
import { assemblePrompt } from "./presets";
import { generateSeedance } from "@/lib/seedance-video";
import { generateVeo } from "@/lib/gemini-video";
import { generateSora } from "@/lib/openai-video";
import { generateHiggsField } from "@/lib/higgsfield-video";
import { getProvider } from "@/lib/providers";
import type { AspectRatio, ProviderKey, Resolution, Shot } from "@/lib/types";

export interface SubmitInput {
  userId: string;
  projectId?: string | null;
  prompt: string;
  provider: ProviderKey;
  aspect: AspectRatio;
  duration: number;
  resolution: Resolution;
  cameraSlug?: string | null;
  motionSlug?: string | null;
  styleSlug?: string | null;
  characterDescriptor?: string | null;
  imageUrl?: string | null;
}

export interface JobRow {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "done" | "error" | "canceled";
  provider: string;
  prompt: string;
  params: Record<string, unknown>;
  output_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  credits_cost: number;
  error: string | null;
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export class QueueError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Persist a new render job and start it. Caller must already have validated
 * that the user is authenticated. Service-role client is required so we can
 * write the credit-debit row even though the user can't insert into
 * credit_ledger directly.
 */
export async function submit(input: SubmitInput): Promise<{ jobId: string; creditsCost: number }> {
  const svc = createSupabaseServiceClient();
  if (!svc) {
    throw new QueueError("Service-role Supabase key is not configured on the server.", 503);
  }

  // Provider must be configured server-side and (for image-to-video models)
  // a reference image URL must be present. The Workspace UI enforces both,
  // but we re-check here so the public /api/v1/renders endpoint and any other
  // direct caller can't bypass.
  let providerInfo;
  try {
    providerInfo = getProvider(input.provider);
  } catch {
    throw new QueueError(`Unknown provider: ${input.provider}`, 400);
  }
  if (!providerInfo.available) {
    throw new QueueError(
      `${providerInfo.name} is not configured on the server: ${providerInfo.missingMessage}`,
      503,
    );
  }
  if (providerInfo.cliOnly) {
    throw new QueueError(`${providerInfo.name} is CLI-only in this build.`, 400);
  }
  if (providerInfo.requiresImage && !input.imageUrl?.trim()) {
    throw new QueueError(
      `${providerInfo.name} is image-to-video — pass an imageUrl alongside the prompt.`,
      400,
    );
  }

  const creditsCost = estimateCreditsCost({
    duration: input.duration,
    resolution: input.resolution,
    motionSlug: input.motionSlug,
  });

  const fullPrompt = assemblePrompt({
    prompt: input.prompt,
    cameraSlug: input.cameraSlug,
    motionSlug: input.motionSlug,
    styleSlug: input.styleSlug,
    characterDescriptor: input.characterDescriptor,
  });

  // Insert the job row first so we have a stable jobId to attach the debit to.
  // (The DB will refund the credits via failJob() if anything below fails.)
  const { data: job, error: jobErr } = await svc
    .from("render_jobs")
    .insert({
      user_id: input.userId,
      project_id: input.projectId ?? null,
      status: "queued",
      provider: input.provider,
      prompt: fullPrompt,
      params: {
        rawPrompt: input.prompt,
        aspect: input.aspect,
        duration: input.duration,
        resolution: input.resolution,
        cameraSlug: input.cameraSlug ?? null,
        motionSlug: input.motionSlug ?? null,
        styleSlug: input.styleSlug ?? null,
        characterDescriptor: input.characterDescriptor ?? null,
        imageUrl: input.imageUrl ?? null,
      },
      duration: input.duration,
      credits_cost: creditsCost,
    })
    .select()
    .single();
  if (jobErr || !job) {
    throw new QueueError(`failed to enqueue job: ${jobErr?.message ?? "unknown"}`, 500);
  }

  // Atomic debit via the SQL function — wraps a SELECT FOR UPDATE around the
  // balance check so two concurrent submits for the same user can't both pass
  // when the balance only covers one of them.
  const { error: rpcErr } = await svc.rpc("debit_credits", {
    p_user_id: input.userId,
    p_amount: creditsCost,
    p_reason: "render_job",
    p_ref_id: job.id,
  });
  if (rpcErr) {
    // Roll the job back so we don't leave an orphaned 'queued' row that the
    // user already sees in the queue panel.
    await svc.from("render_jobs").delete().eq("id", job.id);
    if (rpcErr.message.includes("insufficient_credits")) {
      throw new QueueError(
        `Insufficient credits: need ${creditsCost}. Top up under Billing.`,
        402,
      );
    }
    throw new QueueError(`debit failed: ${rpcErr.message}`, 500);
  }

  // Fire and forget. We DON'T await — the API route returns the jobId
  // immediately so the client can subscribe to the SSE stream. The runner
  // has its own error handling and writes failures to the row.
  //
  // NOTE: This depends on the long-lived Node process model (Render.com
  // deploys this app — see render.yaml). On a serverless host (e.g. Vercel)
  // we'd need `waitUntil` from @vercel/functions or a separate worker.
  void runJob(job.id).catch(async (err) => {
    await failJob(svc, job.id, err instanceof Error ? err.message : String(err));
  });

  return { jobId: job.id, creditsCost };
}

/**
 * Worker. Picks up the row, calls the provider, writes the output URL.
 * Idempotent at the boundary: if it's called twice for the same job (e.g.
 * a retry handler kicks in), the second call short-circuits when status is
 * already 'processing' or terminal.
 */
export async function runJob(jobId: string): Promise<void> {
  const svc = createSupabaseServiceClient();
  if (!svc) throw new Error("service-role client not configured");

  const claimed = await claim(svc, jobId);
  if (!claimed) return;

  const params = claimed.params as {
    aspect: AspectRatio;
    duration: number;
    resolution: Resolution;
    imageUrl: string | null;
  };

  const shot: Shot = {
    prompt: claimed.prompt,
    aspect_ratio: params.aspect,
    duration: params.duration,
    resolution: params.resolution,
    image_url: params.imageUrl,
    label: "render",
  };

  const slug = `job-${claimed.id.slice(0, 8)}`;
  const filename = "render.mp4";
  const destPath = path.join(process.cwd(), "public", "output", slug, filename);
  const publicUrl = `/api/video/${slug}/${filename}`;

  const reportProgress = async (status: string, progress: number) => {
    await svc
      .from("render_jobs")
      .update({ progress: Math.min(99, Math.max(0, progress)) })
      .eq("id", claimed.id);
  };

  let result: { videoUrl: string };
  await reportProgress("submitted", 10);

  try {
    if (claimed.provider === "seedance") {
      result = await generateSeedance({
        shot,
        destPath,
        publicUrl,
        onStatus: (s) => void reportProgress(s, 50),
      });
    } else if (claimed.provider === "gemini") {
      result = await generateVeo({ shot, destPath, publicUrl, onStatus: (s) => void reportProgress(s, 50) });
    } else if (claimed.provider === "chatgpt") {
      result = await generateSora({ shot, destPath, publicUrl, onStatus: (s) => void reportProgress(s, 50) });
    } else if (claimed.provider === "higgsfield") {
      result = await generateHiggsField({ shot, destPath, publicUrl, onStatus: (s) => void reportProgress(s, 50) });
    } else {
      throw new Error(`unsupported provider: ${claimed.provider}`);
    }
  } catch (err) {
    await failJob(svc, claimed.id, err instanceof Error ? err.message : String(err));
    return;
  }

  await svc
    .from("render_jobs")
    .update({
      status: "done",
      output_url: result.videoUrl,
      progress: 100,
      finished_at: new Date().toISOString(),
    })
    .eq("id", claimed.id);
}

async function claim(svc: SupabaseClient, jobId: string): Promise<JobRow | null> {
  // Best-effort claim: only succeed if status is still 'queued'. If two
  // workers race for the same job, only one passes the WHERE clause.
  const { data, error } = await svc
    .from("render_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select()
    .maybeSingle();

  if (error) throw new Error(`claim failed: ${error.message}`);
  if (!data) return null; // already claimed
  return data as JobRow;
}

async function failJob(svc: SupabaseClient, jobId: string, message: string): Promise<void> {
  const { data: job } = await svc
    .from("render_jobs")
    .update({
      status: "error",
      error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .select("user_id, credits_cost")
    .maybeSingle();

  // Refund the credit debit we made at submit time.
  if (job?.user_id && job.credits_cost > 0) {
    await svc.from("credit_ledger").insert({
      user_id: job.user_id,
      amount: job.credits_cost,
      reason: "refund",
      ref_id: jobId,
    });
  }
}

/** Helper for the SSE endpoint — fetches one job. */
export async function getJob(jobId: string): Promise<JobRow | null> {
  const svc = createSupabaseServiceClient();
  if (!svc) return null;
  const { data } = await svc.from("render_jobs").select("*").eq("id", jobId).maybeSingle();
  return (data as JobRow) ?? null;
}
