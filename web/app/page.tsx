"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProviderInfo } from "@/lib/providers";
import type {
  AspectRatio,
  OutputType,
  ProviderKey,
  Shot,
  Storyboard,
  StreamEvent,
} from "@/lib/types";
import { OUTPUT_TYPES, slugify } from "@/lib/types";

type ShotState = { status: string; videoUrl?: string; error?: string };
type ImageItem = { index: number; url: string };

const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "9:21"];

export default function Page() {
  const [outputType, setOutputType] = useState<OutputType>("video");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<ProviderKey>("gemini");
  const [concept, setConcept] = useState("a lone astronaut walking across martian dunes at dawn");
  const [aspect, setAspect] = useState<AspectRatio | "">("16:9");
  const [shots, setShots] = useState(2);
  const [imageCount, setImageCount] = useState(4);
  const [imageUrl, setImageUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Video result state
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [shotStates, setShotStates] = useState<ShotState[]>([]);

  // Image result state
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imageStatus, setImageStatus] = useState<string>("");
  const [imageTitle, setImageTitle] = useState<string>("");

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: { providers: ProviderInfo[] }) => {
        setProviders(data.providers);
        const firstReady = data.providers.find((p) => p.available && !p.cliOnly);
        if (firstReady) setProvider(firstReady.key);
      })
      .catch((err) => setError(`could not load providers: ${err.message}`));
  }, []);

  // Providers shown for the current output type
  const visibleProviders = useMemo(
    () => providers.filter((p) => p.supportedOutputs.includes(outputType)),
    [providers, outputType],
  );

  // If the selected provider doesn't support the new type, switch automatically
  useEffect(() => {
    if (!visibleProviders.length) return;
    if (!visibleProviders.find((p) => p.key === provider)) {
      const firstReady = visibleProviders.find((p) => p.available && !p.cliOnly);
      setProvider((firstReady ?? visibleProviders[0]!).key);
    }
  }, [visibleProviders, provider]);

  const selectedProvider = providers.find((p) => p.key === provider);

  const completedShots = shotStates
    .map((s, i) => ({ url: s.videoUrl, index: i + 1 }))
    .filter((s): s is { url: string; index: number } => Boolean(s.url));

  const storyboardJsonUrl = board
    ? `/api/video/${slugify(board.title)}/storyboard.json`
    : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!selectedProvider?.available) {
      setError(
        `model not available: ${selectedProvider?.name ?? provider} — ${selectedProvider?.missingMessage ?? ""}`,
      );
      return;
    }
    if (selectedProvider.cliOnly) {
      setError(`${selectedProvider.name} is CLI-only in this build.`);
      return;
    }
    if (outputType === "video" && selectedProvider.requiresImage && !imageUrl.trim()) {
      setError(
        `${selectedProvider.name} is an image-to-video model — paste a reference image URL into the field below before generating.`,
      );
      return;
    }

    setBusy(true);
    setBoard(null);
    setShotStates([]);
    setImages([]);
    setImageStatus("");

    try {
      if (outputType === "video") {
        await runVideoFlow();
      } else if (outputType === "image") {
        await runImageFlow();
      } else {
        // D / E / F land here once we add their endpoints. For now, friendly message.
        setError(
          `${OUTPUT_TYPES.find((o) => o.key === outputType)?.label} generation is coming next — currently only Video and Image are wired.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runVideoFlow() {
    const cleanedImageUrl = imageUrl.replace(/\s+/g, "").trim() || null;
    const sbResp = await fetch("/api/storyboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concept,
        aspect: aspect || null,
        shots,
        imageUrl: cleanedImageUrl,
      }),
    });
    const sbData = await sbResp.json();
    if (!sbResp.ok) throw new Error(sbData.error || "storyboard failed");

    const storyboard = sbData.storyboard as Storyboard;
    setBoard(storyboard);
    setShotStates(storyboard.shots.map(() => ({ status: "queued" })));

    for (let i = 0; i < storyboard.shots.length; i++) {
      const shot = storyboard.shots[i]!;
      await streamShot({
        provider,
        shot,
        title: storyboard.title,
        index: i + 1,
        onUpdate: (next) =>
          setShotStates((prev) => {
            const copy = [...prev];
            copy[i] = { ...copy[i]!, ...next };
            return copy;
          }),
      });
    }
  }

  async function runImageFlow() {
    const title = concept.split(/\s+/).slice(0, 5).join(" ") || "image";
    setImageTitle(title);
    setImageStatus("submitting");

    const resp = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        prompt: concept,
        title,
        count: imageCount,
        aspect: aspect || "1:1",
      }),
    });
    if (!resp.ok || !resp.body) throw new Error(`request failed: HTTP ${resp.status}`);

    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "progress") setImageStatus(ev.status);
          else if (ev.type === "image")
            setImages((prev) => [...prev, { index: ev.index, url: ev.url }]);
          else if (ev.type === "error") throw new Error(ev.message);
        } catch (innerErr) {
          if (innerErr instanceof Error) throw innerErr;
        }
      }
    }
    setImageStatus("ready");
  }

  return (
    <main>
      <header className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#7c8cff" />
                <stop offset="1" stopColor="#3ddae0" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="28" height="28" rx="7" stroke="url(#g)" strokeWidth="2" />
            <path d="M11 11h10v3h-3.5v9h-3v-9H11z" fill="url(#g)" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>Tekaida</h1>
          <span className="brand-sub">multi-modal generative studio</span>
        </div>
        <span className="brand-tag">v0.3 · beta</span>
      </header>
      <p className="subtitle">
        Turn a one-sentence concept into video, images, decks, infographics, or illustrated books.
        Powered by <strong>Gemini</strong>, <strong>OpenAI</strong>, <strong>HiggsField</strong>, and <strong>Seedance</strong>.
      </p>

      <form className="panel" onSubmit={onSubmit}>
        {/* Output type selector */}
        <div className="field">
          <label>output type</label>
          <div className="output-types">
            {OUTPUT_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`output-tab ${outputType === t.key ? "active" : ""}`}
                onClick={() => setOutputType(t.key)}
                title={t.tagline}
              >
                <span className="output-label">{t.label}</span>
                <span className="output-tagline">{t.tagline}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="concept">concept</label>
          <textarea
            id="concept"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="describe what you want to generate in one sentence"
          />
        </div>

        <div className="field">
          <label>provider</label>
          <div className="providers">
            {visibleProviders.map((p) => {
              const disabled = !p.available || p.cliOnly;
              const status = p.cliOnly ? "cli" : p.available ? "ready" : "missing";
              const statusLabel = p.cliOnly ? "CLI only" : p.available ? "ready" : "no key";
              return (
                <div
                  key={p.key}
                  className={`provider-card ${provider === p.key ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                  onClick={() => !disabled && setProvider(p.key)}
                  title={disabled ? p.missingMessage : p.description}
                >
                  <div className="name">{p.name}</div>
                  <div className="desc">{p.description}</div>
                  <div className={`status ${status}`}>{statusLabel}</div>
                </div>
              );
            })}
          </div>
          {selectedProvider && !selectedProvider.available && (
            <div className="error">
              <strong>model not available:</strong> {selectedProvider.name} — {selectedProvider.missingMessage}
            </div>
          )}
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="aspect">aspect</label>
            <select
              id="aspect"
              value={aspect}
              onChange={(e) => setAspect(e.target.value as AspectRatio | "")}
            >
              <option value="">auto</option>
              {ASPECTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          {outputType === "video" && (
            <div className="field">
              <label htmlFor="shots">shots (1-4)</label>
              <input
                id="shots"
                type="number"
                min={1}
                max={4}
                value={shots}
                onChange={(e) => setShots(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
              />
            </div>
          )}
          {outputType === "image" && (
            <div className="field">
              <label htmlFor="count">how many images (1-4)</label>
              <input
                id="count"
                type="number"
                min={1}
                max={4}
                value={imageCount}
                onChange={(e) => setImageCount(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
              />
            </div>
          )}
          {outputType === "video" && (
            <div className="field">
              <label htmlFor="image">
                reference image URL {selectedProvider?.requiresImage ? "(required)" : "(optional)"}
              </label>
              <input
                id="image"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                required={selectedProvider?.requiresImage}
                style={selectedProvider?.requiresImage && !imageUrl.trim() ? { borderColor: "var(--warn)" } : undefined}
              />
            </div>
          )}
        </div>

        <button
          className="btn"
          type="submit"
          disabled={busy || !selectedProvider?.available || selectedProvider?.cliOnly}
        >
          {busy ? "working…" : `generate ${OUTPUT_TYPES.find((o) => o.key === outputType)?.label.toLowerCase()}`}
        </button>
        {error && <div className="error">{error}</div>}
      </form>

      {/* Video results */}
      {board && outputType === "video" && (
        <>
          <div className="board-header">
            <h2>{board.title}</h2>
            <p>{board.logline}</p>
          </div>
          <div className="shot-grid">
            {board.shots.map((shot, i) => (
              <ShotCard
                key={i}
                index={i + 1}
                slug={slugify(board.title)}
                shot={shot}
                state={shotStates[i] ?? { status: "queued" }}
              />
            ))}
          </div>
          {(completedShots.length > 0 || storyboardJsonUrl) && (
            <div className="action-bar">
              {completedShots.length > 0 && (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => downloadAll(completedShots, slugify(board.title), "mp4")}
                >
                  ⤓ Download all videos ({completedShots.length})
                </button>
              )}
              {storyboardJsonUrl && (
                <a
                  className="btn ghost"
                  href={storyboardJsonUrl}
                  download={`${slugify(board.title)}-storyboard.json`}
                >
                  ⤓ Download storyboard.json
                </a>
              )}
            </div>
          )}
        </>
      )}

      {/* Image results */}
      {outputType === "image" && (images.length > 0 || imageStatus) && (
        <>
          <div className="board-header">
            <h2>{imageTitle || concept}</h2>
            <p>
              {images.length} image{images.length === 1 ? "" : "s"} generated via {selectedProvider?.name}
              {imageStatus && imageStatus !== "ready" ? ` · ${imageStatus}` : ""}
            </p>
          </div>
          <div className="image-grid">
            {images.map((img) => (
              <div key={img.index} className="image-tile">
                <img src={img.url} alt={`Generated image ${img.index}`} />
                <div className="shot-actions">
                  <a
                    className="btn primary sm"
                    href={img.url}
                    download={`${slugify(imageTitle || "image")}-${String(img.index).padStart(2, "0")}.png`}
                  >
                    ⤓ Download PNG
                  </a>
                  <a className="btn ghost sm" href={img.url} target="_blank" rel="noreferrer">
                    ↗ Open
                  </a>
                </div>
              </div>
            ))}
            {!images.length && imageStatus && (
              <div className="shot-status">
                <span className="pulse" /> {imageStatus}
              </div>
            )}
          </div>
          {images.length > 0 && (
            <div className="action-bar">
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  downloadAll(
                    images.map((i) => ({ url: i.url, index: i.index })),
                    slugify(imageTitle || "image"),
                    "png",
                  )
                }
              >
                ⤓ Download all images ({images.length})
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function ShotCard({
  index,
  slug,
  shot,
  state,
}: {
  index: number;
  slug: string;
  shot: Shot;
  state: ShotState;
}) {
  return (
    <div className="shot">
      <div className="shot-header">
        <span className="shot-num">#{String(index).padStart(2, "0")}</span>
        <span className="label">{shot.label || "shot"}</span>
        <span className="meta-pills">
          <span className="pill">{shot.aspect_ratio}</span>
          <span className="pill">{shot.duration}s</span>
          <span className="pill">{shot.resolution}</span>
        </span>
      </div>
      <div className="shot-prompt">{shot.prompt}</div>
      {state.videoUrl ? (
        <>
          <video src={state.videoUrl} controls preload="metadata" />
          <div className="shot-actions">
            <a
              className="btn primary sm"
              href={state.videoUrl}
              download={`${slug}-shot-${String(index).padStart(2, "0")}.mp4`}
            >
              ⤓ Download MP4
            </a>
            <a className="btn ghost sm" href={state.videoUrl} target="_blank" rel="noreferrer">
              ↗ Open in new tab
            </a>
          </div>
        </>
      ) : state.error ? (
        <div className="error">{state.error}</div>
      ) : (
        <div className="shot-status">
          <span className="pulse" /> {state.status}
        </div>
      )}
    </div>
  );
}

function downloadAll(
  items: { url: string; index: number }[],
  slug: string,
  ext: "mp4" | "png",
) {
  items.forEach((item, i) => {
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = item.url;
      a.download = `${slug}-${String(item.index).padStart(2, "0")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 400);
  });
}

async function streamShot(opts: {
  provider: ProviderKey;
  shot: Shot;
  title: string;
  index: number;
  onUpdate: (next: Partial<ShotState>) => void;
}) {
  opts.onUpdate({ status: "submitting" });
  const resp = await fetch("/api/generate-shot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: opts.provider,
      shot: opts.shot,
      title: opts.title,
      index: opts.index,
    }),
  });
  if (!resp.ok || !resp.body) {
    opts.onUpdate({ error: `request failed: HTTP ${resp.status}` });
    return;
  }

  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as StreamEvent;
        if (ev.type === "progress") opts.onUpdate({ status: ev.status });
        else if (ev.type === "done") opts.onUpdate({ status: "ready", videoUrl: ev.videoUrl });
        else if (ev.type === "error") opts.onUpdate({ error: ev.message });
      } catch {
        /* ignore malformed line */
      }
    }
  }
}
