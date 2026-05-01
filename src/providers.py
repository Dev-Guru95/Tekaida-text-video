"""Registry of video generation providers.

Each provider knows how to:
  - check whether its API credentials are present in the environment, and
  - run a Storyboard through its model and write MP4s to disk.

`PROVIDERS` is the single source of truth for the CLI's --provider choices and
for the "model not available" message shown when keys are missing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable

from . import gemini_video, hf_generator, openai_video
from .storyboard import ShotResult


@dataclass(frozen=True)
class Provider:
    key: str
    name: str
    description: str
    keys_ok: Callable[[], bool]
    missing_message: str
    generate: Callable[..., list[ShotResult]]


def _gemini_keys_ok() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def _openai_keys_ok() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def _higgsfield_keys_ok() -> bool:
    return bool(
        os.environ.get("HF_KEY")
        or (os.environ.get("HF_API_KEY") and os.environ.get("HF_API_SECRET"))
    )


PROVIDERS: dict[str, Provider] = {
    "gemini": Provider(
        key="gemini",
        name="Gemini Veo",
        description="Google Veo 3 via the Gemini API",
        keys_ok=_gemini_keys_ok,
        missing_message="set GEMINI_API_KEY in .env (https://aistudio.google.com/apikey)",
        generate=gemini_video.generate_storyboard,
    ),
    "chatgpt": Provider(
        key="chatgpt",
        name="OpenAI Sora",
        description="OpenAI Sora 2 via the OpenAI API",
        keys_ok=_openai_keys_ok,
        missing_message="set OPENAI_API_KEY in .env (https://platform.openai.com/api-keys)",
        generate=openai_video.generate_storyboard,
    ),
    "higgsfield": Provider(
        key="higgsfield",
        name="HiggsField",
        description="HiggsField Cloud (DOP, Seedance, Kling, Veo)",
        keys_ok=_higgsfield_keys_ok,
        missing_message="set HF_KEY (or HF_API_KEY + HF_API_SECRET) in .env (https://cloud.higgsfield.ai/)",
        generate=hf_generator.generate_storyboard,
    ),
}


def get(provider_key: str) -> Provider:
    if provider_key not in PROVIDERS:
        raise KeyError(f"Unknown provider {provider_key!r}. Choose from {list(PROVIDERS)}.")
    return PROVIDERS[provider_key]
