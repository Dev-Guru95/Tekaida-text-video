import { GoogleGenAI } from "@google/genai";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Shot } from "./types";

const POLL_MS = 10_000;

export async function generateVeo(opts: {
  shot: Shot;
  destPath: string;
  publicUrl: string;
  onStatus?: (s: string) => void;
}): Promise<{ videoUrl: string }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  opts.onStatus?.("submitting to Veo");

  const aspectRatio: "16:9" | "9:16" =
    opts.shot.aspect_ratio === "9:16" ? "9:16" : "16:9";

  let operation = await client.models.generateVideos({
    model: process.env.VEO_MODEL || "veo-3.0-generate-001",
    prompt: opts.shot.prompt,
    config: { aspectRatio, numberOfVideos: 1 },
  });

  while (!operation.done) {
    opts.onStatus?.("generating");
    await new Promise((r) => setTimeout(r, POLL_MS));
    operation = await client.operations.getVideosOperation({ operation });
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
