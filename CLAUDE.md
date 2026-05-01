# claude-higgs-field

A Gemini-driven pipeline that turns a creative concept into one or more short
videos. The storyboard is always written by Gemini; the video provider is
selectable (Gemini Veo, OpenAI Sora, or HiggsField).

## Flow
1. User supplies a concept (1 sentence is fine) and optionally `--provider`.
2. `src/gemini_writer.py` asks Gemini for a JSON storyboard: title, logline, 1-4 shots (prompt, aspect, duration, resolution).
3. `video.py` checks that the selected provider's API key is configured. If not, it prints "model not available" and exits.
4. The selected provider in `src/providers.py` runs each shot and downloads the resulting MP4 into `output/<slug>/shot-NN.mp4`. The full storyboard is persisted to `output/<slug>/storyboard.json`.

## Providers
| key          | name           | env var(s) required                               | module                |
|--------------|----------------|---------------------------------------------------|-----------------------|
| `gemini`     | Gemini Veo 3   | `GEMINI_API_KEY`                                  | `src/gemini_video.py` |
| `chatgpt`    | OpenAI Sora 2  | `OPENAI_API_KEY`                                  | `src/openai_video.py` |
| `higgsfield` | HiggsField     | `HF_KEY` *or* `HF_API_KEY` + `HF_API_SECRET`      | `src/hf_generator.py` |

Default provider is `gemini`. If a provider's key is missing, the CLI prints
"model not available" along with a per-provider availability table — so the
user can see at a glance which models they can run.

## Run
```
python video.py "a lone astronaut walking across martian dunes at dawn"
python video.py --provider chatgpt "cat knocks mug off table, slow motion"
python video.py --provider higgsfield --aspect 9:16 --shots 2 "..."
python video.py --image https://example.com/car.jpg "camera orbits the parked car"
python video.py --dry-run "any idea"   # storyboard only, no API spend
```

## Environment
Copy `.env.example` -> `.env`, then fill the keys for whichever providers you
plan to use. You only need a key for the provider you select; the others will
report "not available" but won't block the rest.

## Notes for future Claude sessions
- The storyboard writer is Gemini-only by design (the user asked us to drop Claude). Don't reintroduce `anthropic`.
- `src/storyboard.py` owns the `Shot`, `Storyboard`, and `ShotResult` data classes plus the shared `save_manifest` / `emit` helpers. Every provider imports from it.
- Each provider exposes `generate_storyboard(board, *, output_root, on_event, **_unused)` so they're interchangeable behind `Provider.generate` in `src/providers.py`.
- The HiggsField SDK uses endpoint strings like `vendor/model/version/task`. The catalog lives on the Cloud dashboard — if a submit call fails with "unknown endpoint", ask the user to paste the correct string. Result payloads vary by endpoint; `_pick_video_url` in `hf_generator.py` walks the payload looking for any string ending in `.mp4/.mov/.webm/.m4v` — extend it rather than hardcoding a key path if a new endpoint returns a non-standard URL.
- Veo 3 only supports 16:9 and 9:16; `_veo_aspect` clamps anything else to 16:9. Sora's allowed `seconds` values are 4/8/12 — `_sora_seconds` rounds the storyboard's 5/10 to the nearest.
- Gemini writer is strict-JSON (`response_mime_type="application/json"`); on parse failure it prints the raw response before raising, so the user can see what came back.
- Respect copyright: the system prompt forbids named celebrities or trademarked characters.
