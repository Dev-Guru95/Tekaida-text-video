"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AspectRatio, ProviderKey, Resolution } from "@/lib/types";
import { estimateCreditsCost } from "@/lib/build/credits";
import { readLastPrompt, readPrefs, writeLastPrompt } from "@/lib/build/prefs";
import { CameraChips, MotionChips, StyleChips } from "./PresetChips";
import { JobCard, type JobSnapshot } from "./JobCard";

const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "9:21"];
const RESOLUTIONS: Resolution[] = ["480p", "720p", "1080p"];
const DURATION_OPTIONS = [4, 5, 8, 10, 12, 15];

interface ProjectOption {
  id: string;
  name: string;
}

interface ProviderInfo {
  key: ProviderKey;
  name: string;
  description: string;
  available: boolean;
  missingMessage: string;
  cliOnly: boolean;
  requiresImage: boolean;
  supportedOutputs: string[];
}

/**
 * The actual generation surface. Big prompt textarea, three preset chip rows
 * (camera / motion / style), per-job knobs (aspect / duration / resolution /
 * provider), an optional reference-image URL for image-to-video providers,
 * a character descriptor box for character-consistency mode, the live cost
 * preview, and the running render queue panel below.
 */
export function WorkspacePanel({
  onJobSubmitted,
  balance,
}: {
  onJobSubmitted: () => void;
  balance: number;
}) {
  const [prompt, setPrompt] = useState(
    "a lone astronaut walking across martian dunes at dawn, golden hour light",
  );
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<Resolution>("720p");

  const [cameraSlug, setCameraSlug] = useState<string | null>("dolly-in");
  const [motionSlug, setMotionSlug] = useState<string | null>("natural");
  const [styleSlug, setStyleSlug] = useState<string | null>("cinematic");
  const [characterDescriptor, setCharacterDescriptor] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const [provider, setProvider] = useState<ProviderKey>("seedance");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [pollKey, setPollKey] = useState(0);
  const pollTimer = useRef<number | null>(null);

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>("");

  // Track whether the user has typed in the prompt — once they have, we stop
  // overwriting it with the saved last-prompt on settings sync.
  const promptDirty = useRef(false);
  const autoSavePromptsRef = useRef(true);

  // Apply user prefs once on mount. Doing it before fetch /providers means
  // the first selectable engine matches the user's saved choice (assuming
  // their key is set) — we still fall through to first-available if not.
  useEffect(() => {
    const prefs = readPrefs();
    setAspect(prefs.defaultAspect);
    setResolution(prefs.defaultResolution);
    setDuration(prefs.defaultDuration);
    setProvider(prefs.defaultProvider);
    autoSavePromptsRef.current = prefs.autoSavePrompts;
    if (prefs.autoSavePrompts) {
      const saved = readLastPrompt();
      if (saved && !promptDirty.current) setPrompt(saved);
    }
  }, []);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d: { providers: ProviderInfo[] }) => {
        setProviders(d.providers);
        // Honor the user's pref if available; otherwise prefer SeaDance, else
        // the first available non-CLI provider.
        const prefs = readPrefs();
        const preferred = d.providers.find(
          (p) => p.key === prefs.defaultProvider && p.available && !p.cliOnly,
        );
        if (preferred) {
          setProvider(preferred.key);
          return;
        }
        const sea = d.providers.find((p) => p.key === "seedance" && p.available && !p.cliOnly);
        if (sea) setProvider("seedance");
        else {
          const any = d.providers.find((p) => p.available && !p.cliOnly);
          if (any) setProvider(any.key);
        }
      })
      .catch(() => undefined);
  }, []);

  // Pull project list once so the selector renders. Empty for unauthenticated
  // users — picker is hidden in that case.
  useEffect(() => {
    fetch("/api/build/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { items?: { id: string; name: string }[] }) => {
        setProjects(d.items ?? []);
      })
      .catch(() => undefined);
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.key === provider),
    [providers, provider],
  );

  // Fetch the recent jobs list and any active job's progress.
  // The cadence (1.5s while anything is in flight, 5s otherwise) is computed
  // off the freshly-fetched response — reading `jobs` from state here would
  // be one tick stale because we close over the value at effect-run time.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      let nextDelay = 5000;
      try {
        const r = await fetch("/api/build/jobs", { cache: "no-store" });
        const d = (await r.json()) as { items?: JobSnapshot[] };
        if (cancelled) return;
        const items = d.items ?? [];
        setJobs(items);
        if (items.some((j) => j.status === "queued" || j.status === "processing")) {
          nextDelay = 1500;
        }
      } catch {
        /* ignore transient errors — we re-poll */
      } finally {
        if (!cancelled) {
          pollTimer.current = window.setTimeout(
            () => setPollKey((k) => k + 1),
            nextDelay,
          );
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [pollKey]);

  const cost = estimateCreditsCost({ duration, resolution, motionSlug });
  const insufficient = balance > 0 && cost > balance;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (autoSavePromptsRef.current) writeLastPrompt(prompt);
      const r = await fetch("/api/build/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider,
          aspect,
          duration,
          resolution,
          cameraSlug,
          motionSlug,
          styleSlug,
          projectId: projectId || undefined,
          characterDescriptor: characterDescriptor.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `submit failed: HTTP ${r.status}`);

      onJobSubmitted();
      setPollKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const requiresImage = selectedProvider?.requiresImage ?? false;

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">Build a cinematic clip</h2>
          <p className="ws-sub">
            One prompt → one render. SeaDance 2.0 by default; switch the engine on the right if you need
            something specific.
          </p>
        </div>
        <div className="ws-cost-pill">
          <span className="ws-cost-label">est. cost</span>
          <span className={`ws-cost-value ${insufficient ? "danger" : ""}`}>{cost} cr</span>
        </div>
      </header>

      <form className="ws-form" onSubmit={onSubmit}>
        <div className="ws-prompt-row">
          <label htmlFor="ws-prompt" className="ws-label">Prompt</label>
          <textarea
            id="ws-prompt"
            className="ws-prompt"
            value={prompt}
            onChange={(e) => {
              promptDirty.current = true;
              setPrompt(e.target.value);
            }}
            placeholder="One sentence describing the shot. The presets below decorate it before we send to the model."
            rows={3}
            required
          />
        </div>

        <div className="ws-section">
          <div className="ws-section-head">
            <span className="ws-section-title">Cinematic camera</span>
            <span className="ws-section-hint">how the lens moves</span>
          </div>
          <CameraChips value={cameraSlug} onChange={setCameraSlug} />
        </div>

        <div className="ws-section">
          <div className="ws-section-head">
            <span className="ws-section-title">Motion preset</span>
            <span className="ws-section-hint">energy + speed of action</span>
          </div>
          <MotionChips value={motionSlug} onChange={setMotionSlug} />
        </div>

        <div className="ws-section">
          <div className="ws-section-head">
            <span className="ws-section-title">Style preset</span>
            <span className="ws-section-hint">photographic + grade</span>
          </div>
          <StyleChips value={styleSlug} onChange={setStyleSlug} />
        </div>

        <div className="ws-section">
          <div className="ws-section-head">
            <span className="ws-section-title">Character consistency</span>
            <span className="ws-section-hint">describe the recurring subject — appearance, clothing, demeanor</span>
          </div>
          <input
            type="text"
            className="ws-input"
            value={characterDescriptor}
            onChange={(e) => setCharacterDescriptor(e.target.value)}
            placeholder="e.g. Maya — late 20s, short black bob, olive jumpsuit, calm and observant"
          />
        </div>

        <div className="ws-grid">
          <div className="ws-field">
            <label className="ws-label" htmlFor="ws-aspect">Aspect</label>
            <select
              id="ws-aspect"
              value={aspect}
              onChange={(e) => setAspect(e.target.value as AspectRatio)}
              className="ws-input"
            >
              {ASPECTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="ws-field">
            <label className="ws-label" htmlFor="ws-duration">Duration (s)</label>
            <select
              id="ws-duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="ws-input"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}s</option>
              ))}
            </select>
          </div>
          <div className="ws-field">
            <label className="ws-label" htmlFor="ws-res">Resolution</label>
            <select
              id="ws-res"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as Resolution)}
              className="ws-input"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="ws-field">
            <label className="ws-label" htmlFor="ws-provider">Engine</label>
            <select
              id="ws-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderKey)}
              className="ws-input"
            >
              {providers
                .filter((p) => p.supportedOutputs.includes("video"))
                .map((p) => (
                  <option key={p.key} value={p.key} disabled={!p.available || p.cliOnly}>
                    {p.name} {p.available ? "" : "· no key"}
                  </option>
                ))}
            </select>
          </div>
          {projects.length > 0 && (
            <div className="ws-field">
              <label className="ws-label" htmlFor="ws-project">Project</label>
              <select
                id="ws-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="ws-input"
              >
                <option value="">— none —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {requiresImage && (
          <div className="ws-section">
            <div className="ws-section-head">
              <span className="ws-section-title">Reference image</span>
              <span className="ws-section-hint">required by {selectedProvider?.name} (image-to-video)</span>
            </div>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              className="ws-input"
              required={requiresImage}
            />
          </div>
        )}

        {error && <div className="ws-error">{error}</div>}
        {selectedProvider && !selectedProvider.available && (
          <div className="ws-warn">
            <strong>{selectedProvider.name}</strong> is not configured — {selectedProvider.missingMessage}
          </div>
        )}

        <div className="ws-actions">
          <button
            className="btn ws-submit"
            type="submit"
            disabled={
              submitting ||
              !selectedProvider?.available ||
              insufficient ||
              (requiresImage && !imageUrl.trim())
            }
          >
            {submitting ? "Submitting…" : insufficient ? "Insufficient credits" : `Render — ${cost} cr`}
          </button>
        </div>
      </form>

      <div className="ws-queue">
        <div className="ws-queue-head">
          <h3 className="ws-queue-title">Render queue</h3>
          <span className="ws-queue-hint">
            {jobs.filter((j) => j.status === "queued" || j.status === "processing").length} active
            · {jobs.length} total
          </span>
        </div>

        {jobs.length === 0 ? (
          <div className="ws-empty">
            <span className="ws-empty-glyph">▦</span>
            <span>Submit a render to populate this queue. Active jobs stream progress every second.</span>
          </div>
        ) : (
          <div className="ws-queue-grid">
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} onRefresh={() => setPollKey((k) => k + 1)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
