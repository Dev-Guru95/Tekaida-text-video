"use client";

import { useEffect, useRef, useState } from "react";

export interface JobSnapshot {
  id: string;
  status: "queued" | "processing" | "done" | "error" | "canceled";
  provider: string;
  prompt: string;
  output_url: string | null;
  thumbnail_url?: string | null;
  duration: number | null;
  credits_cost: number;
  progress: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  params?: Record<string, unknown>;
}

/**
 * Single tile in the render queue. Subscribes to the SSE stream while the
 * job is non-terminal so progress updates without polling. When done, swaps
 * to a video player with download + open-in-tab actions.
 */
export function JobCard({
  job,
  onRefresh,
}: {
  job: JobSnapshot;
  onRefresh: () => void;
}) {
  const [progress, setProgress] = useState(job.progress);
  const [status, setStatus] = useState(job.status);
  const [outputUrl, setOutputUrl] = useState(job.output_url);
  const [error, setError] = useState(job.error);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setProgress(job.progress);
    setStatus(job.status);
    setOutputUrl(job.output_url);
    setError(job.error);
  }, [job.progress, job.status, job.output_url, job.error]);

  useEffect(() => {
    // Only stream while the job is alive.
    if (status !== "queued" && status !== "processing") return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const r = await fetch(`/api/build/jobs/${job.id}/stream`, { signal: ctrl.signal });
        if (!r.ok || !r.body) return;
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
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
              const ev = JSON.parse(line) as {
                type: string;
                status?: JobSnapshot["status"];
                progress?: number;
                output_url?: string | null;
                error?: string | null;
              };
              if (ev.type === "tick" || ev.type === "done") {
                if (typeof ev.progress === "number") setProgress(ev.progress);
                if (ev.status) setStatus(ev.status);
                if (typeof ev.output_url !== "undefined") setOutputUrl(ev.output_url ?? null);
                if (typeof ev.error !== "undefined") setError(ev.error ?? null);
                if (ev.type === "done") onRefresh();
              }
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } catch {
        /* aborted or transient; the polling fallback in WorkspacePanel will catch up */
      }
    })();

    return () => ctrl.abort();
  }, [job.id, status, onRefresh]);

  const cancel = async () => {
    await fetch(`/api/build/jobs/${job.id}`, { method: "DELETE" });
    onRefresh();
  };

  const truncatedPrompt = job.prompt.length > 140 ? job.prompt.slice(0, 140) + "…" : job.prompt;
  const isActive = status === "queued" || status === "processing";

  return (
    <article className={`job-card status-${status}`}>
      <header className="job-card-head">
        <span className={`job-status job-${status}`}>{status}</span>
        <span className="job-meta">{job.provider} · {job.duration ?? "?"}s · {job.credits_cost} cr</span>
      </header>

      <div className="job-prompt">{truncatedPrompt}</div>

      {isActive && (
        <>
          <div className="job-progress">
            <div className="job-progress-bar" style={{ width: `${Math.max(5, progress)}%` }} />
          </div>
          <div className="job-actions">
            <button type="button" className="btn ghost sm" onClick={cancel}>Cancel</button>
            <span className="job-elapsed">{progress}%</span>
          </div>
        </>
      )}

      {status === "done" && outputUrl && (
        <>
          <video src={outputUrl} controls preload="metadata" className="job-video" />
          <div className="job-actions">
            <a className="btn primary sm" href={outputUrl} download>
              ⤓ MP4
            </a>
            <a className="btn ghost sm" href={outputUrl} target="_blank" rel="noreferrer">
              ↗ Open
            </a>
          </div>
        </>
      )}

      {status === "error" && (
        <div className="job-error">
          <strong>render failed:</strong> {error ?? "unknown error"}
        </div>
      )}

      {status === "canceled" && (
        <div className="job-canceled">canceled — credits refunded</div>
      )}
    </article>
  );
}
