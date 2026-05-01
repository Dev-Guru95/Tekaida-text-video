"""Generate videos via OpenAI Sora 2.

Sora exposes a job-style API: create -> poll until status == "completed" ->
download_content. We map the storyboard's aspect_ratio + resolution onto
Sora's `size` parameter and round duration to one of Sora's allowed values.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable

from openai import OpenAI

from .storyboard import Shot, ShotResult, Storyboard, emit, save_manifest

DEFAULT_MODEL = os.environ.get("SORA_MODEL", "sora-2")
POLL_SECONDS = 5

_SIZES = {
    ("16:9", "720p"): "1280x720",
    ("16:9", "1080p"): "1920x1080",
    ("9:16", "720p"): "720x1280",
    ("9:16", "1080p"): "1080x1920",
    ("1:1", "720p"): "720x720",
    ("1:1", "1080p"): "1024x1024",
}


def generate_storyboard(
    board: Storyboard,
    *,
    output_root: Path = Path("output"),
    on_event: Callable[[str], None] | None = None,
    **_unused,
) -> list[ShotResult]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set — get one at https://platform.openai.com/api-keys"
        )

    client = OpenAI(api_key=api_key)
    out_dir = output_root / board.slug()
    out_dir.mkdir(parents=True, exist_ok=True)
    save_manifest(out_dir, board, provider="chatgpt")

    results: list[ShotResult] = []
    for i, shot in enumerate(board.shots, start=1):
        emit(on_event, f"[shot {i}/{len(board.shots)}] submitting to Sora: {shot.label or shot.prompt[:60]}")

        video = client.videos.create(
            model=DEFAULT_MODEL,
            prompt=shot.prompt,
            seconds=_sora_seconds(shot.duration),
            size=_sora_size(shot),
        )

        while video.status in ("queued", "in_progress"):
            emit(on_event, f"[shot {i}] {video.status}")
            time.sleep(POLL_SECONDS)
            video = client.videos.retrieve(video.id)

        if video.status != "completed":
            raise RuntimeError(f"Shot {i} failed: status={video.status}")

        dest = out_dir / f"shot-{i:02d}.mp4"
        content = client.videos.download_content(video.id, variant="video")
        content.write_to_file(str(dest))

        emit(on_event, f"[shot {i}] saved -> {dest}")
        results.append(
            ShotResult(index=i, shot=shot, video_path=dest, source_url=video.id)
        )

    return results


def _sora_size(shot: Shot) -> str:
    return _SIZES.get((shot.aspect_ratio, shot.resolution), "1280x720")


def _sora_seconds(duration: int) -> str:
    # Sora 2 supports 4 / 8 / 12 second clips — round our 5/10 to the nearest.
    if duration <= 5:
        return "4"
    if duration <= 9:
        return "8"
    return "12"
