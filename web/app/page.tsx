"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AuthButton } from "@/components/AuthButton";
import { HistorySidebar, type HistoryItem } from "@/components/HistorySidebar";

type ShotState = { status: string; videoUrl?: string; error?: string };
type ImageItem = { index: number; url: string };
type DeckResult = {
  title: string;
  subtitle: string;
  slideCount: number;
  downloadUrl: string;
  outline: { title: string; bullets: string[] }[];
};
type InfographicResult = {
  title: string;
  subtitle: string;
  layout: string;
  points: { heading: string; value: string; detail: string }[];
  svgUrl: string;
  pngUrl?: string;
};
type BookResult = {
  title: string;
  subtitle: string;
  chapterCount: number;
  chapters: { title: string }[];
  downloadUrl: string;
};

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

  // Deck result state
  const [deck, setDeck] = useState<DeckResult | null>(null);
  const [deckStatus, setDeckStatus] = useState<string>("");

  // Infographic result state
  const [infographic, setInfographic] = useState<InfographicResult | null>(null);
  const [infographicStatus, setInfographicStatus] = useState<string>("");

  // Book result state
  const [book, setBook] = useState<BookResult | null>(null);
  const [bookStatus, setBookStatus] = useState<string>("");

  const [slideCount, setSlideCount] = useState(8);
  const [chapterCount, setChapterCount] = useState(5);

  // History (Supabase) — refreshKey bumps after each successful save
  const [historyKey, setHistoryKey] = useState(0);

  const recordGeneration = useCallback(
    async (entry: {
      output_type: OutputType;
      title?: string;
      concept: string;
      provider: string;
      output_url?: string;
      metadata?: Record<string, unknown>;
    }) => {
      try {
        const r = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
        if (r.ok) setHistoryKey((k) => k + 1);
      } catch {
        // Memory feature is optional; never block generation flow on history failures.
      }
    },
    [],
  );

  const restoreHistoryItem = useCallback((item: HistoryItem) => {
    setOutputType(item.output_type);
    setConcept(item.concept);
    setError(null);
  }, []);

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
    setDeck(null);
    setDeckStatus("");
    setInfographic(null);
    setInfographicStatus("");
    setBook(null);
    setBookStatus("");

    try {
      if (outputType === "video") {
        await runVideoFlow();
      } else if (outputType === "image") {
        await runImageFlow();
      } else if (outputType === "deck") {
        await runDeckFlow();
      } else if (outputType === "infographic") {
        await runInfographicFlow();
      } else if (outputType === "book") {
        await runBookFlow();
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
    await recordGeneration({
      output_type: "video",
      title: storyboard.title,
      concept,
      provider,
      output_url: `/api/video/${slugify(storyboard.title)}/shot-01.mp4`,
      metadata: { shotCount: storyboard.shots.length },
    });
  }

  async function runBookFlow() {
    setBookStatus("submitting");
    const resp = await fetch("/api/generate-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, chapterCount }),
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
          if (ev.type === "progress") setBookStatus(ev.status);
          else if (ev.type === "book") {
            const bk = ev as BookResult;
            setBook(bk);
            recordGeneration({
              output_type: "book",
              title: bk.title,
              concept,
              provider: "gemini",
              output_url: bk.downloadUrl,
              metadata: { chapterCount: bk.chapterCount },
            });
          }
          else if (ev.type === "error") throw new Error(ev.message);
        } catch (innerErr) {
          if (innerErr instanceof Error) throw innerErr;
        }
      }
    }
    setBookStatus("ready");
  }

  async function runInfographicFlow() {
    setInfographicStatus("submitting");
    const resp = await fetch("/api/generate-infographic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, renderImage: true }),
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
          if (ev.type === "progress") setInfographicStatus(ev.status);
          else if (ev.type === "infographic") {
            const ig = ev as InfographicResult;
            setInfographic(ig);
            recordGeneration({
              output_type: "infographic",
              title: ig.title,
              concept,
              provider: "gemini",
              output_url: ig.pngUrl ?? ig.svgUrl,
              metadata: { layout: ig.layout, hasPng: Boolean(ig.pngUrl) },
            });
          }
          else if (ev.type === "error") throw new Error(ev.message);
        } catch (innerErr) {
          if (innerErr instanceof Error) throw innerErr;
        }
      }
    }
    setInfographicStatus("ready");
  }

  async function runDeckFlow() {
    setDeckStatus("submitting");
    const resp = await fetch("/api/generate-deck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, slideCount }),
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
          if (ev.type === "progress") setDeckStatus(ev.status);
          else if (ev.type === "deck") {
            const d = ev as DeckResult;
            setDeck(d);
            recordGeneration({
              output_type: "deck",
              title: d.title,
              concept,
              provider: "gemini",
              output_url: d.downloadUrl,
              metadata: { slideCount: d.slideCount },
            });
          }
          else if (ev.type === "error") throw new Error(ev.message);
        } catch (innerErr) {
          if (innerErr instanceof Error) throw innerErr;
        }
      }
    }
    setDeckStatus("ready");
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
          else if (ev.type === "image") {
            setImages((prev) => [...prev, { index: ev.index, url: ev.url }]);
            if (ev.index === 1) {
              recordGeneration({
                output_type: "image",
                title,
                concept,
                provider,
                output_url: ev.url,
              });
            }
          }
          else if (ev.type === "error") throw new Error(ev.message);
        } catch (innerErr) {
          if (innerErr instanceof Error) throw innerErr;
        }
      }
    }
    setImageStatus("ready");
  }

  return (
    <main className="layout-grid">
      <HistorySidebar refreshKey={historyKey} onRestore={restoreHistoryItem} />
      <div className="layout-main">
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
        <AuthButton onUserChange={() => setHistoryKey((k) => k + 1)} />
        <span className="brand-tag">v0.4 · beta</span>
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
          {outputType === "deck" && (
            <div className="field">
              <label htmlFor="slides-count">slides (4-12)</label>
              <input
                id="slides-count"
                type="number"
                min={4}
                max={12}
                value={slideCount}
                onChange={(e) => setSlideCount(Math.max(4, Math.min(12, Number(e.target.value) || 8)))}
              />
            </div>
          )}
          {outputType === "book" && (
            <div className="field">
              <label htmlFor="chapter-count">chapters (3-8)</label>
              <input
                id="chapter-count"
                type="number"
                min={3}
                max={8}
                value={chapterCount}
                onChange={(e) => setChapterCount(Math.max(3, Math.min(8, Number(e.target.value) || 5)))}
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

      {/* Book results */}
      {outputType === "book" && (book || bookStatus) && (
        <>
          <div className="board-header">
            <h2>{book?.title ?? "Generating illustrated book"}</h2>
            <p>
              {book
                ? `${book.subtitle} · ${book.chapterCount} chapters`
                : bookStatus || "starting…"}
            </p>
          </div>
          {book ? (
            <>
              <div className="deck-outline">
                {book.chapters.map((c, i) => (
                  <div key={i} className="deck-slide-card">
                    <div className="shot-header">
                      <span className="shot-num">CH{String(i + 1).padStart(2, "0")}</span>
                      <span className="label">{c.title}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="action-bar">
                <a className="btn" href={book.downloadUrl} download={`${slugify(book.title)}.pdf`}>
                  ⤓ Download PDF
                </a>
                <a className="btn ghost" href={book.downloadUrl} target="_blank" rel="noreferrer">
                  ↗ Open in browser
                </a>
              </div>
            </>
          ) : (
            <div className="shot-status">
              <span className="pulse" /> {bookStatus}
            </div>
          )}
        </>
      )}

      {/* Infographic results */}
      {outputType === "infographic" && (infographic || infographicStatus) && (
        <>
          <div className="board-header">
            <h2>{infographic?.title ?? "Generating infographic"}</h2>
            <p>
              {infographic
                ? `${infographic.subtitle} · ${infographic.layout}`
                : infographicStatus || "starting…"}
            </p>
          </div>
          {infographic ? (
            <>
              <div className="infographic-pair">
                <div className="image-tile">
                  <div className="tile-label">SVG (vector)</div>
                  <img src={infographic.svgUrl} alt={`${infographic.title} — SVG`} />
                  <div className="shot-actions">
                    <a className="btn primary sm" href={infographic.svgUrl} download={`${slugify(infographic.title)}.svg`}>
                      ⤓ Download SVG
                    </a>
                    <a className="btn ghost sm" href={infographic.svgUrl} target="_blank" rel="noreferrer">
                      ↗ Open
                    </a>
                  </div>
                </div>
                {infographic.pngUrl && (
                  <div className="image-tile">
                    <div className="tile-label">PNG (Imagen render)</div>
                    <img src={infographic.pngUrl} alt={`${infographic.title} — PNG`} />
                    <div className="shot-actions">
                      <a className="btn primary sm" href={infographic.pngUrl} download={`${slugify(infographic.title)}.png`}>
                        ⤓ Download PNG
                      </a>
                      <a className="btn ghost sm" href={infographic.pngUrl} target="_blank" rel="noreferrer">
                        ↗ Open
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="shot-status">
              <span className="pulse" /> {infographicStatus}
            </div>
          )}
        </>
      )}

      {/* Deck results */}
      {outputType === "deck" && (deck || deckStatus) && (
        <>
          <div className="board-header">
            <h2>{deck?.title ?? "Generating deck"}</h2>
            <p>
              {deck
                ? `${deck.subtitle} · ${deck.slideCount} slides`
                : deckStatus || "starting…"}
            </p>
          </div>
          {deck ? (
            <>
              <div className="deck-outline">
                {deck.outline.map((s, i) => (
                  <div key={i} className="deck-slide-card">
                    <div className="shot-header">
                      <span className="shot-num">#{String(i + 1).padStart(2, "0")}</span>
                      <span className="label">{s.title}</span>
                    </div>
                    <ul className="deck-bullets">
                      {s.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="action-bar">
                <a className="btn" href={deck.downloadUrl} download={`${slugify(deck.title)}.pptx`}>
                  ⤓ Download PPTX
                </a>
                <a className="btn ghost" href={deck.downloadUrl} target="_blank" rel="noreferrer">
                  ↗ Open in browser
                </a>
              </div>
            </>
          ) : (
            <div className="shot-status">
              <span className="pulse" /> {deckStatus}
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
      </div>
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
