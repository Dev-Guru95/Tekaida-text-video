/**
 * Image generation via Google Imagen (Gemini API).
 *
 * Uses `client.models.generateImages(...)` which returns base64 PNG bytes
 * synchronously (no long-running operation). Imagen 4 is the current
 * state-of-the-art Google text-to-image model and produces 1-4 images
 * per call.
 */

import { GoogleGenAI } from "@google/genai";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AspectRatio } from "./types";

const DEFAULT_MODEL = process.env.IMAGEN_MODEL || "imagen-4.0-generate-001";

export async function generateImagen(opts: {
  prompt: string;
  count: number;
  aspectRatio: AspectRatio;
  outDir: string;
  publicUrlBase: string;
  onStatus?: (s: string) => void;
}): Promise<{ imageUrls: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  opts.onStatus?.("submitting to Imagen");

  const aspect = mapAspect(opts.aspectRatio);

  const resp = await client.models.generateImages({
    model: DEFAULT_MODEL,
    prompt: opts.prompt,
    config: {
      numberOfImages: Math.min(Math.max(opts.count, 1), 4),
      aspectRatio: aspect,
    },
  });

  const generated = resp.generatedImages ?? [];
  if (!generated.length) {
    throw new Error(
      "Imagen returned no images. The prompt may have been blocked by Google's safety filter — " +
        "try rewording without sensitive content (named people, alcohol, violence, etc).",
    );
  }

  await mkdir(opts.outDir, { recursive: true });
  const imageUrls: string[] = [];

  for (let i = 0; i < generated.length; i++) {
    const img = generated[i]!;
    const bytes = img.image?.imageBytes;
    if (!bytes) continue;
    const buffer = Buffer.from(bytes, "base64");
    const filename = `image-${String(i + 1).padStart(2, "0")}.png`;
    await writeFile(join(opts.outDir, filename), buffer);
    imageUrls.push(`${opts.publicUrlBase}/${filename}`);
    opts.onStatus?.(`saved image ${i + 1}/${generated.length}`);
  }

  if (!imageUrls.length) throw new Error("Imagen returned images but none had decodable bytes.");
  return { imageUrls };
}

function mapAspect(a: AspectRatio): "1:1" | "16:9" | "9:16" | "4:3" | "3:4" {
  switch (a) {
    case "16:9": return "16:9";
    case "9:16": return "9:16";
    case "1:1":  return "1:1";
    case "4:3":  return "4:3";
    case "9:21": return "9:16";
    default:     return "1:1";
  }
}
