import { GoogleGenAI } from "@google/genai";
import type { AspectRatio, Shot, Storyboard } from "./types";

const SYSTEM_PROMPT = `You are a director turning creative concepts into a video shot list.

Output strictly valid JSON matching this schema — no prose, no code fences:

{
  "title": string,
  "logline": string,
  "shots": [
    {
      "label": string,
      "prompt": string,
      "aspect_ratio": "16:9" | "9:16" | "1:1" | "4:3" | "9:21",
      "duration": 5 | 10,
      "resolution": "720p" | "1080p"
    }
  ]
}

Guidelines:
- Prefer 9:16 for social/vertical, 16:9 for cinematic/YouTube.
- Default 5s unless the action clearly needs 10s.
- Write prompts a video model can execute: concrete nouns, verbs, light, camera move.
- Avoid named celebrities, trademarked characters, or copyrighted properties.
`;

export async function writeStoryboard(opts: {
  concept: string;
  aspectHint?: AspectRatio | null;
  maxShots?: number;
}): Promise<Storyboard> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  const maxShots = opts.maxShots ?? 3;
  let user = `Concept: ${opts.concept}\n\nReturn at most ${maxShots} shot(s).`;
  if (opts.aspectHint) user += `\nPreferred aspect ratio: ${opts.aspectHint}.`;

  const resp = await client.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
    contents: user,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
    },
  });

  const text = (resp.text ?? "").trim();
  const cleaned = text
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  let data: { title: string; logline: string; shots: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    console.error("[gemini-writer] failed to parse JSON. Raw response:\n", text);
    throw err;
  }

  return {
    title: data.title,
    logline: data.logline,
    shots: data.shots.map((s): Shot => ({
      prompt: String(s.prompt ?? ""),
      aspect_ratio: (s.aspect_ratio as AspectRatio) ?? "16:9",
      duration: Number(s.duration ?? 5),
      resolution: (s.resolution as Shot["resolution"]) ?? "1080p",
      label: String(s.label ?? ""),
    })),
  };
}
