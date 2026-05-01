"""Concept -> storyboard -> video.

Storyboard is always written by Gemini. The video provider is selectable via
--provider (gemini / chatgpt / higgsfield). If the chosen provider's API key
is not configured in .env, the CLI exits with "model not available".

Usage:
    python video.py "a lone astronaut walking across martian dunes at dawn"
    python video.py --provider chatgpt "cat knocks mug off table, slow motion"
    python video.py --provider higgsfield --aspect 9:16 --shots 2 "..."
    python video.py --image https://example.com/car.jpg "camera orbits the parked car"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from src.gemini_writer import write_storyboard
from src.providers import PROVIDERS, get
from src.storyboard import Storyboard

console = Console()


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = _parse_args(argv)

    provider = get(args.provider)
    if not provider.keys_ok():
        console.print(
            Panel.fit(
                f"[bold red]model not available[/]: {provider.name}\n"
                f"[dim]{provider.missing_message}[/]",
                title="provider check",
                border_style="red",
            )
        )
        _print_provider_table(args.provider)
        return 2

    console.print(Panel.fit(f"[bold cyan]{args.concept}[/]", title="concept"))
    console.print(f"[dim]video provider:[/] [bold]{provider.name}[/] ({provider.description})")

    with console.status("[bold]writing storyboard with Gemini..."):
        board = write_storyboard(
            args.concept,
            aspect_hint=args.aspect,
            max_shots=args.shots,
        )

    if args.image:
        for s in board.shots:
            s.image_url = args.image

    _print_storyboard(board)

    if args.dry_run:
        console.print("[yellow]--dry-run: skipping video generation[/]")
        return 0

    def log(msg: str) -> None:
        console.print(f"  [dim]{msg}[/]")

    results = provider.generate(
        board,
        output_root=Path(args.output),
        on_event=log,
    )

    console.print()
    console.print(Panel.fit(
        "\n".join(f"{r.index:>2}. {r.video_path}" for r in results),
        title=f"[bold green]done — {len(results)} shot(s) via {provider.name}[/]",
    ))
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("concept", help="high-level creative idea")
    p.add_argument(
        "--provider",
        choices=list(PROVIDERS.keys()),
        default="gemini",
        help="video generation backend (default: gemini)",
    )
    p.add_argument("--aspect", choices=["16:9", "9:16", "1:1", "4:3", "9:21"], default=None)
    p.add_argument("--shots", type=int, default=3, help="max number of shots (1-4)")
    p.add_argument("--image", default=None, help="reference image URL (applies to all shots)")
    p.add_argument("--output", default="output", help="output directory root")
    p.add_argument("--dry-run", action="store_true", help="storyboard only, no video generation")
    return p.parse_args(argv)


def _print_storyboard(board: Storyboard) -> None:
    t = Table(title=f"[bold]{board.title}[/]  —  {board.logline}", show_lines=True)
    t.add_column("#", width=3)
    t.add_column("label", width=14)
    t.add_column("aspect", width=6)
    t.add_column("dur", width=4)
    t.add_column("prompt")
    for i, s in enumerate(board.shots, start=1):
        t.add_row(str(i), s.label, s.aspect_ratio, f"{s.duration}s", s.prompt)
    console.print(t)


def _print_provider_table(selected: str) -> None:
    t = Table(title="provider availability", show_lines=False)
    t.add_column("provider")
    t.add_column("name")
    t.add_column("status")
    for key, prov in PROVIDERS.items():
        status = "[green]ready[/]" if prov.keys_ok() else "[red]not available[/]"
        marker = " [bold yellow]<- selected[/]" if key == selected else ""
        t.add_row(key, prov.name, status + marker)
    console.print(t)


if __name__ == "__main__":
    sys.exit(main())
