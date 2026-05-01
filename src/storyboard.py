"""Shared storyboard data classes and small I/O helpers used by every provider."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

AspectRatio = Literal["16:9", "9:16", "1:1", "4:3", "9:21"]
Resolution = Literal["480p", "720p", "1080p"]


@dataclass
class Shot:
    prompt: str
    aspect_ratio: AspectRatio = "16:9"
    duration: int = 5
    resolution: Resolution = "1080p"
    image_url: str | None = None
    label: str = ""


@dataclass
class Storyboard:
    title: str
    logline: str
    shots: list[Shot] = field(default_factory=list)

    def slug(self) -> str:
        s = re.sub(r"[^a-zA-Z0-9]+", "-", self.title.strip().lower()).strip("-")
        return s or "untitled"


@dataclass
class ShotResult:
    index: int
    shot: Shot
    video_path: Path
    source_url: str


def save_manifest(out_dir: Path, board: Storyboard, *, provider: str) -> None:
    manifest = {
        "title": board.title,
        "logline": board.logline,
        "provider": provider,
        "generated_at": int(time.time()),
        "shots": [
            {
                "label": s.label,
                "prompt": s.prompt,
                "aspect_ratio": s.aspect_ratio,
                "duration": s.duration,
                "resolution": s.resolution,
                "image_url": s.image_url,
            }
            for s in board.shots
        ],
    }
    (out_dir / "storyboard.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )


def emit(cb: Callable[[str], None] | None, msg: str) -> None:
    if cb:
        cb(msg)
