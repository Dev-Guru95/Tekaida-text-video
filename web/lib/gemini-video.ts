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

function isVeoOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : JSON.stringify(err);
  return /UNAVAILABLE|"code"\s*:\s*503|\b503\b|high demand|temporarily unavailable/i.test(
    msg,
  );
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
  const aspectRatio: "16:9" | "9:16" =
    opts.shot.aspect_ratio === "9:16" ? "9:16" : "16:9";

  // One outer try/catch translates ANY 503/UNAVAILABLE thrown anywhere in
  // submit / poll / download into a single user-facing message instead of
  // leaking Google's raw error JSON.
  try {
    opts.onStatus?.("submitting to Veo");

    type VeoOperation = Awaited<ReturnType<typeof client.models.generateVideos>>;
    let operation: VeoOperation = await veoRetry<VeoOperation>(
      () =>
        client.models.generateVideos({
          model,
          prompt: opts.shot.prompt,
          config: { aspectRatio, numberOfVideos: 1 },
        }),
      (attempt, total, msg) => {
        console.log(`[veo] submit transient error (attempt ${attempt}/${total}): ${msg.slice(0, 200)}`);
        opts.onStatus?.(`Veo busy — retrying (${attempt}/${total})`);
      },
    );

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
      // Re-throw so the outer catch can translate UNAVAILABLE specifically;
      // anything else falls through to its raw message.
      throw new Error(JSON.stringify(opError));
    }

    const generated = operation.response?.generatedVideos?.[0];
    if (!generated?.video) {
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
  } catch (err) {
    if (isVeoOverloadError(err)) {
      throw new Error(
        `Veo (${model}) is currently overloaded by traffic on Google's side. ` +
          `We retried several times before giving up. Try again in a few minutes, ` +
          `or switch to a different provider in the picker (HiggsField, Sora). ` +
          `If this keeps happening, switch VEO_MODEL to "veo-3.0-fast-generate-001" — ` +
          `the fast variant has higher capacity.`,
      );
    }
    throw err;
  }
}
