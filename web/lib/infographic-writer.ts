/**
 * Infographic writer — Gemini turns a concept into a tight infographic spec
 * (title + structured data points + a rendering prompt for Imagen). The
 * resulting JSON is rendered into both a styled SVG (vector) and a PNG via
 * Imagen so the user gets a downloadable raster + an editable SVG.
 */

import { GoogleGenAI } from "@google/genai";

export interface InfographicPoint {
  heading: string;       // 1-3 words
  value: string;         // headline number or stat (e.g. "78%")
  detail: string;        // one-sentence supporting note
}

export interface InfographicSpec {
  title: string;
  subtitle: string;
  layout: "stat-grid" | "process-flow" | "comparison" | "timeline";
  points: InfographicPoint[];
  imagePrompt: string;   // detailed prompt for Imagen to render the visual
}

const SYSTEM_PROMPT = `You design infographics. Turn the user's concept into strict JSON
matching this schema — no prose, no code fences:

{
  "title": string,                          // 3-7 words
  "subtitle": string,                       // one tagline sentence
  "layout": "stat-grid" | "process-flow" | "comparison" | "timeline",
  "points": [                               // 4-6 points
    {
      "heading": string,                    // 1-3 words
      "value": string,                      // a stat or short fact (e.g. "78%", "3x", "1.2M")
      "detail": string                      // one-sentence supporting note
    }
  ],
  "imagePrompt": string                     // 60-100 words, detailed prompt for an
                                            // image model to render the infographic
}

For "imagePrompt", describe a visually balanced infographic layout: title at top, the points
arranged per the chosen layout, clean modern typography (sans-serif), a deep navy background
(#0B0F1E), indigo (#8B8BFF) and cyan (#3DDAE0) accents, no embedded text errors, high
contrast, vector-style flat illustration, 4K quality.`;

export async function writeInfographic(opts: {
  concept: string;
  model?: string;
}): Promise<InfographicSpec> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  const resp = await client.models.generateContent({
    model: opts.model || process.env.GEMINI_MODEL || "gemini-2.5-pro",
    contents: `Concept: ${opts.concept}`,
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
  const data = JSON.parse(cleaned) as InfographicSpec;
  if (!data?.points?.length || !data.imagePrompt) {
    throw new Error("Infographic writer returned invalid JSON.");
  }
  return data;
}
