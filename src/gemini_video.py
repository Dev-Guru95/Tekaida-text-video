"""Generate videos via Google Veo (Gemini API).

Uses the long-running operation pattern: submit -> poll -> download. Veo
returns a single MP4 per shot through the GenAI Files API; we save it
directly to disk.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable

from google import genai
from google.genai import types

from .storyboard import Shot, ShotResult, Storyboard, emit, save_manifest

DEFAULT_MODEL = os.environ.get("VEO_MODEL", "veo-3.0-generate-001")
POLL_SECONDS = 10


def generate_storyboard(
    board: Storyboard,
    *,
    output_root: Path = Path("output"),
    on_event: Callable[[str], None] | None = None,
    **_unused,
) -> list[ShotResult]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set — get one at https://aistudio.google.com/apikey"
        )

    client = genai.Client(api_key=api_key)
    out_dir = output_root / board.slug()
    out_dir.mkdir(parents=True, exist_ok=True)
    save_manifest(out_dir, board, provider="gemini")

    results: list[ShotResult] = []
    for i, shot in enumerate(board.shots, start=1):
        emit(on_event, f"[shot {i}/{len(board.shots)}] submitting to Veo: {shot.label or shot.prompt[:60]}")

        config = types.GenerateVideosConfig(aspect_ratio=_veo_aspect(shot.aspect_ratio))
        operation = client.models.generate_videos(
            model=DEFAULT_MODEL,
            prompt=shot.prompt,
            image=_veo_image(shot),
            config=config,
        )

        while not operation.done:
            emit(on_event, f"[shot {i}] generating...")
            time.sleep(POLL_SECONDS)
            operation = client.operations.get(operation)

        if getattr(operation, "error", None):
            raise RuntimeError(f"Shot {i} failed: {operation.error}")

        generated = operation.response.generated_videos[0]
        client.files.download(file=generated.video)
        dest = out_dir / f"shot-{i:02d}.mp4"
        generated.video.save(str(dest))

        emit(on_event, f"[shot {i}] saved -> {dest}")
        results.append(
            ShotResult(
                index=i,
                shot=shot,
                video_path=dest,
                source_url=getattr(generated.video, "uri", "") or "",
            )
        )

    return results


def _veo_aspect(aspect: str) -> str:
    # Veo 3 currently supports 16:9 and 9:16 — clamp anything else to 16:9.
    return aspect if aspect in ("16:9", "9:16") else "16:9"


def _veo_image(shot: Shot):
    if not shot.image_url:
        return None
    return types.Image(gcs_uri=shot.image_url) if shot.image_url.startswith("gs://") else None
