/**
 * Image generation via OpenAI gpt-image-1 (the successor to DALL-E 3).
 * Returns base64 PNG bytes synchronously, multiple per call.
 */

import OpenAI from "openai";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AspectRatio } from "./types";

const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

export async function generateOpenAIImage(opts: {
  prompt: string;
  count: number;
  aspectRatio: AspectRatio;
  outDir: string;
  publicUrlBase: string;
  onStatus?: (s: string) => void;
}): Promise<{ imageUrls: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const client = new OpenAI({ apiKey });
  opts.onStatus?.("submitting to gpt-image-1");

  // gpt-image-1 supports 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape)
  const size = mapSize(opts.aspectRatio);

  const resp = await client.images.generate({
    model: DEFAULT_MODEL,
    prompt: opts.prompt,
    n: Math.min(Math.max(opts.count, 1), 4),
    size,
  });

  const data = resp.data ?? [];
  if (!data.length) throw new Error("OpenAI returned no images.");

  await mkdir(opts.outDir, { recursive: true });
  const imageUrls: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const img = data[i]!;
    const b64 = img.b64_json;
    if (!b64) continue;
    const buffer = Buffer.from(b64, "base64");
    const filename = `image-${String(i + 1).padStart(2, "0")}.png`;
    await writeFile(join(opts.outDir, filename), buffer);
    imageUrls.push(`${opts.publicUrlBase}/${filename}`);
    opts.onStatus?.(`saved image ${i + 1}/${data.length}`);
  }

  if (!imageUrls.length) throw new Error("OpenAI returned images with no decodable bytes.");
  return { imageUrls };
}

type GptImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";

function mapSize(a: AspectRatio): GptImageSize {
  switch (a) {
    case "9:16":
    case "9:21":
      return "1024x1536";
    case "16:9":
      return "1536x1024";
    case "1:1":
    case "4:3":
    default:
      return "1024x1024";
  }
}
