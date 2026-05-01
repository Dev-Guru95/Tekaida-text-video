"""Submit shots to HiggsField Cloud and download the resulting video files.

Uses the official `higgsfield_client` SDK's submit/poll pattern. The result
payload shape varies by endpoint, so we scan it for the first URL ending in a
known video extension and download that.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Iterable

import higgsfield_client as hf
import httpx

from .storyboard import Shot, ShotResult, Storyboard, emit, save_manifest

VIDEO_EXTS = (".mp4", ".mov", ".webm", ".m4v")

DEFAULT_T2V = os.environ.get(
    "HF_TEXT_TO_VIDEO_ENDPOINT", "higgsfield/dop/v1/text-to-video"
)
DEFAULT_I2V = os.environ.get(
    "HF_IMAGE_TO_VIDEO_ENDPOINT", "higgsfield/dop/v1/image-to-video"
)


def generate_storyboard(
    board: Storyboard,
    *,
    output_root: Path = Path("output"),
    endpoint_override: str | None = None,
    on_event: Callable[[str], None] | None = None,
    **_unused,
) -> list[ShotResult]:
    out_dir = output_root / board.slug()
    out_dir.mkdir(parents=True, exist_ok=True)
    save_manifest(out_dir, board, provider="higgsfield")

    results: list[ShotResult] = []
    for i, shot in enumerate(board.shots, start=1):
        emit(on_event, f"[shot {i}/{len(board.shots)}] submitting: {shot.label or shot.prompt[:60]}")
        endpoint = endpoint_override or (DEFAULT_I2V if shot.image_url else DEFAULT_T2V)
        arguments = _shot_arguments(shot)

        controller = hf.submit(endpoint, arguments=arguments)
        for status in controller.poll_request_status():
            emit(on_event, f"[shot {i}] {type(status).__name__}")
            if isinstance(status, (hf.Failed, hf.NSFW, hf.Cancelled)):
                raise RuntimeError(f"Shot {i} failed: {type(status).__name__}")

        payload = controller.get()
        video_url = _pick_video_url(payload)
        if not video_url:
            raise RuntimeError(f"Shot {i} returned no video URL. Payload: {payload!r}")

        dest = out_dir / f"shot-{i:02d}.mp4"
        _download(video_url, dest)
        emit(on_event, f"[shot {i}] saved -> {dest}")
        results.append(ShotResult(index=i, shot=shot, video_path=dest, source_url=video_url))

    return results


def _shot_arguments(shot: Shot) -> dict[str, Any]:
    args: dict[str, Any] = {
        "prompt": shot.prompt,
        "aspect_ratio": shot.aspect_ratio,
        "duration": shot.duration,
        "resolution": shot.resolution,
    }
    if shot.image_url:
        args["image_url"] = shot.image_url
    return args


def _pick_video_url(payload: Any) -> str | None:
    for value in _walk(payload):
        if isinstance(value, str) and value.lower().split("?", 1)[0].endswith(VIDEO_EXTS):
            return value
    return None


def _walk(obj: Any) -> Iterable[Any]:
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)
    else:
        yield obj


def _download(url: str, dest: Path) -> None:
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes(chunk_size=1 << 16):
                f.write(chunk)
