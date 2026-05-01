import { GoogleGenAI } from "@google/genai";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Shot } from "./types";

const POLL_MS = 10_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]; // 4 attempts total

/**
 * Retry a Veo SDK call when Google returns a transient 503/UNAVAILABLE
 * ("This model is currently experiencing high demand"). Veo 3 is heavily
 * capacity-constrained, so we treat these as soft failures and back off.
 */
async function veoRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, total: number, msg: string) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /\b(503|429)\b/.test(msg) ||
        /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|temporarily unavailable/i.test(msg);
      if (!transient || attempt === RETRY_DELAYS_MS.length) throw err;
      const delay = RETRY_DELAYS_MS[attempt]!;
      onRetry?.(attempt + 1, RETRY_DELAYS_MS.length + 1, msg);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function generateVeo(opts: {
  shot: Shot;
  destPath: string;
  publicUrl: string;
  onStatus?: (s: string) => void;
}): Promise<{ videoUrl: string }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  const model = process.env.VEO_MODEL || "veo-3.0-generate-001";
  opts.onStatus?.("submitting to Veo");

  const aspectRatio: "16:9" | "9:16" =
    opts.shot.aspect_ratio === "9:16" ? "9:16" : "16:9";

  type VeoOperation = Awaited<ReturnType<typeof client.models.generateVideos>>;
  let operation: VeoOperation;
  try {
    operation = await veoRetry<VeoOperation>(
      () =>
        client.models.generateVideos({
          model,
          prompt: opts.shot.prompt,
          config: { aspectRatio, numberOfVideos: 1 },
        }),
      (attempt, total, msg) => {
        console.log(`[veo] transient error (attempt ${attempt}/${total}): ${msg.slice(0, 200)}`);
        opts.onStatus?.(`Veo busy — retrying (${attempt}/${total})`);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNAVAILABLE|503|high demand/i.test(msg)) {
      throw new Error(
        "Veo is currently overloaded by traffic on Google's side and we couldn't get through after several retries. " +
          "Try again in a few minutes, or switch to a different provider in the picker.",
      );
    }
    throw err;
  }

  while (!operation.done) {
    opts.onStatus?.("generating");
    await new Promise((r) => setTimeout(r, POLL_MS));
    operation = await veoRetry(
      () => client.operations.getVideosOperation({ operation }),
      (attempt, total, msg) => {
        console.log(`[veo poll] transient error (attempt ${attempt}/${total}): ${msg.slice(0, 200)}`);
        opts.onStatus?.(`Veo poll busy — retrying (${attempt}/${total})`);
      },
    );
  }

  const opError = (operation as { error?: unknown }).error;
  if (opError) {
    console.log(`[veo] operation.error: ${JSON.stringify(opError)}`);
    throw new Error(`Veo failed: ${JSON.stringify(opError)}`);
  }

  const generated = operation.response?.generatedVideos?.[0];
  if (!generated?.video) {
    // Veo's safety filters (RAI) silently produce an empty result instead of
    // an explicit error. Dump the entire operation response so we can see
    // what came back, then surface a helpful message to the user.
    console.log(
      "[veo] empty response — full operation:",
      JSON.stringify(operation, null, 2),
    );
    throw new Error(
      "Veo returned no video. This usually means Veo's safety filter rejected " +
        "the prompt — common triggers: alcohol, drugs, violence, named people, " +
        "branded products, or minors. Try rewording the prompt to remove sensitive content.",
    );
  }

  opts.onStatus?.("downloading");
  await mkdir(dirname(opts.destPath), { recursive: true });
  await client.files.download({ file: generated.video, downloadPath: opts.destPath });

  return { videoUrl: opts.publicUrl };
}
