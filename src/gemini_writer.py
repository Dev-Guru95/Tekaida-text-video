"""Turn a high-level creative concept into a structured shot list using Gemini.

Calls the Gemini API with a JSON-only system instruction and validates the
result into a typed Storyboard. The writer is provider-agnostic — the same
storyboard feeds into Veo, Sora, or HiggsField downstream.
"""

from __future__ import annotations

import json
import os
import re

from google import genai
from google.genai import types

from .storyboard import AspectRatio, Shot, Storyboard


SYSTEM_PROMPT = """You are a director turning creative concepts into a video shot list.

Output strictly valid JSON matching this schema — no prose, no code fences:

{
  "title": string,                 // 2-6 words, filename-safe concept
  "logline": string,               // one-sentence premise
  "shots": [                       // 1-4 shots
    {
      "label": string,             // short tag, e.g. "establishing"
      "prompt": string,            // 30-80 words, vivid, cinematic, specific:
                                   //   subject + action + environment + lighting
                                   //   + camera move + lens + mood
      "aspect_ratio": "16:9" | "9:16" | "1:1" | "4:3" | "9:21",
      "duration": 5 | 10,
      "resolution": "720p" | "1080p"
    }
  ]
}

Guidelines:
- Prefer 9:16 for social/vertical, 16:9 for cinematic/YouTube.
- Default 5s unless the action clearly needs 10s.
- Write prompts a video model can execute: concrete nouns, verbs, light.
- Avoid named celebrities, trademarked characters, or copyrighted properties.
"""


def write_storyboard(
    concept: str,
    *,
    aspect_hint: AspectRatio | None = None,
    max_shots: int = 3,
    model: str | None = None,
) -> Storyboard:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set — get one at https://aistudio.google.com/apikey"
        )

    client = genai.Client(api_key=api_key)
    user = f"Concept: {concept}\n\nReturn at most {max_shots} shot(s)."
    if aspect_hint:
        user += f"\nPreferred aspect ratio: {aspect_hint}."

    resp = client.models.generate_content(
        model=model or os.environ.get("GEMINI_MODEL", "gemini-2.5-pro"),
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
        ),
        contents=user,
    )

    text = resp.text or ""
    data = _extract_json(text)

    shots = [
        Shot(
            prompt=s["prompt"],
            aspect_ratio=s.get("aspect_ratio", "16:9"),
            duration=int(s.get("duration", 5)),
            resolution=s.get("resolution", "1080p"),
            label=s.get("label", ""),
        )
        for s in data["shots"]
    ]
    return Storyboard(title=data["title"], logline=data["logline"], shots=shots)


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        print("[gemini_writer] failed to parse JSON. Raw response:")
        print(text)
        raise
