/**
 * ByteDance Seedance — routed through HiggsField Cloud (same auth and submit
 * protocol as the HiggsField provider). Different application path.
 *
 * Note: HiggsField currently publishes only the image-to-video Seedance
 * endpoint (Seedance 1.0 Pro). Text-to-video Seedance is NOT available on
 * HiggsField — for that, use a provider that exposes Seedance T2V (Replicate,
 * Fal.ai, ByteDance Volcengine direct).
 *
 * If/when HF adds a Seedance T2V path, set SEEDANCE_TEXT_TO_VIDEO_ENDPOINT
 * in .env.local and the dispatch in higgsfield-video.ts will pick it up.
 */

import { generateHiggsField } from "./higgsfield-video";
import type { Shot } from "./types";

const DEFAULT_I2V = "bytedance/seedance/v1/pro/image-to-video";

export async function generateSeedance(opts: {
  shot: Shot;
  destPath: string;
  publicUrl: string;
  onStatus?: (s: string) => void;
}): Promise<{ videoUrl: string }> {
  return generateHiggsField({
    shot: opts.shot,
    destPath: opts.destPath,
    publicUrl: opts.publicUrl,
    onStatus: opts.onStatus,
    label: "Seedance 2.0",
    requireImageUrl: true,
    applicationOverride: {
      // Only use the env override if the user explicitly sets a T2V path.
      textToVideo: process.env.SEEDANCE_TEXT_TO_VIDEO_ENDPOINT || undefined,
      imageToVideo: process.env.SEEDANCE_IMAGE_TO_VIDEO_ENDPOINT || DEFAULT_I2V,
    },
  });
}
