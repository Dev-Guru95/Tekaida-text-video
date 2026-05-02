/**
 * Pitch deck writer — Gemini structures a concept into slide JSON, which
 * the deck renderer turns into a PPTX. Strict-JSON output schema:
 *
 *   {
 *     title: string,            // 2-6 words; deck filename
 *     subtitle: string,         // tagline shown on cover slide
 *     slides: [
 *       {
 *         title: string,        // 3-8 words
 *         bullets: string[],    // 3-5 short bullet points
 *         speaker_notes?: string
 *       }
 *     ]
 *   }
 */

import { GoogleGenAI } from "@google/genai";

export interface DeckSlide {
  title: string;
  bullets: string[];
  speaker_notes?: string;
}

export interface DeckSpec {
  title: string;
  subtitle: string;
  slides: DeckSlide[];
}

const SYSTEM_PROMPT = `You are a senior pitch consultant. Turn the user's concept into a tight,
investor-ready pitch deck structured as strict JSON.

Output only JSON — no prose, no code fences. Schema:
{
  "title": string,                    // 2-6 words, used as deck title and filename
  "subtitle": string,                 // one-line tagline
  "slides": [                         // 6-10 slides total
    {
      "title": string,                // 3-8 words, sentence case
      "bullets": string[],            // 3-5 bullets, each 5-15 words
      "speaker_notes": string         // 1-2 sentences for the presenter
    }
  ]
}

Conventional sequence: Cover · Problem · Solution · Market · Product · Traction · Business model · Competition · Team · Ask. Adjust based on the concept.`;

export async function writeDeck(opts: {
  concept: string;
  slideCount?: number;
  model?: string;
}): Promise<DeckSpec> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const client = new GoogleGenAI({ apiKey });
  const slides = Math.min(Math.max(opts.slideCount ?? 8, 4), 12);

  const resp = await client.models.generateContent({
    model: opts.model || process.env.GEMINI_MODEL || "gemini-2.5-pro",
    contents: `Concept: ${opts.concept}\n\nReturn ${slides} slides total.`,
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

  let data: DeckSpec;
  try {
    data = JSON.parse(cleaned) as DeckSpec;
  } catch (err) {
    console.error("[deck-writer] failed to parse JSON. Raw response:\n", text);
    throw err;
  }
  if (!data?.slides?.length) {
    throw new Error("Deck writer returned no slides.");
  }
  return data;
}
