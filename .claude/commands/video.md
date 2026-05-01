---
description: Generate a short video from a concept via Gemini, with optional Sora/HiggsField backends
argument-hint: <concept>  (optionally --provider gemini|chatgpt|higgsfield --aspect 9:16 --shots N --image URL --dry-run)
---

Run the video pipeline for the user's concept. Storyboard is always written by Gemini; the video provider is selectable.

Steps:
1. Check `.env` exists and `GEMINI_API_KEY` is present (required for the storyboard writer). If the user passed `--provider chatgpt`, also require `OPENAI_API_KEY`. If `--provider higgsfield`, require `HF_KEY` (or `HF_API_KEY`+`HF_API_SECRET`). If `--provider` is omitted, the default is `gemini`. If a required key is missing, stop and tell the user exactly which key is missing.
2. Ensure dependencies are installed. If `python -c "import google.genai, openai, higgsfield_client, rich, dotenv"` fails, run `pip install -r requirements.txt` first.
3. Execute: `python video.py "$ARGUMENTS"`. Stream the output so the user sees the storyboard table and per-shot progress in real time. If the CLI prints "model not available", surface that verbatim — it means the selected provider's key isn't set.
4. When finished, list the saved file paths and offer next actions: regenerate a specific shot with a tweaked prompt, switch aspect ratio, switch provider (`--provider chatgpt` / `--provider higgsfield`), or turn this into a longer sequence.

Do NOT wrap the concept in extra quotes — pass `$ARGUMENTS` verbatim so flags like `--provider chatgpt` and `--aspect 9:16` work. Never read `.env`.
