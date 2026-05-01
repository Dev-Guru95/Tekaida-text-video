import OpenAI from "openai";
import type { VideoSize } from "openai/resources/videos";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Shot } from "./types";

const POLL_MS = 5_000;

// Sora 2 currently supports only these four sizes — anything else gets clamped.
function soraSize(shot: Shot): VideoSize {
  return shot.aspect_ratio === "9:16" ? "720x1280" : "1280x720";
}

function soraSeconds(duration: number): "4" | "8" | "12" {
  if (duration <= 5) return "4";
  if (duration <= 9) return "8";
  return "12";
}

export async function generateSora(opts: {
  shot: Shot;
  destPath: string;
  publicUrl: string;
  onStatus?: (s: string) => void;
}): Promise<{ videoUrl: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const client = new OpenAI({ apiKey });
  opts.onStatus?.("submitting to Sora");

  let video = await client.videos.create({
    model: process.env.SORA_MODEL || "sora-2",
    prompt: opts.shot.prompt,
    seconds: soraSeconds(opts.shot.duration),
    size: soraSize(opts.shot),
  });

  while (video.status === "queued" || video.status === "in_progress") {
    opts.onStatus?.(video.status);
    await new Promise((r) => setTimeout(r, POLL_MS));
    video = await client.videos.retrieve(video.id);
  }

  if (video.status !== "completed") {
    const detail = video.error?.message ?? video.status;
    throw new Error(`Sora failed: ${detail}`);
  }

  opts.onStatus?.("downloading");
  const content = await client.videos.downloadContent(video.id, { variant: "video" });
  const buffer = Buffer.from(await content.arrayBuffer());

  await mkdir(dirname(opts.destPath), { recursive: true });
  await writeFile(opts.destPath, buffer);

  return { videoUrl: opts.publicUrl };
}
