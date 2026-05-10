"use client";

import { useEffect, useState } from "react";
import type { JobSnapshot } from "./JobCard";
import { JobCard } from "./JobCard";

/**
 * Library — every render the signed-in user has produced. Re-uses JobCard
 * so a click-through video preview is one tile away. The card handles its
 * own SSE subscription, so an in-flight render in the queue stays live in
 * the library too.
 */
export function LibraryPanel() {
  const [items, setItems] = useState<JobSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/build/jobs", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setItems(d.items ?? []);
        setSignedIn(Boolean(d.signedIn));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pollKey]);

  if (loading) {
    return <div className="ws-empty"><span className="pulse" /> Loading library…</div>;
  }
  if (!signedIn) {
    return (
      <div className="ws-empty">
        <span className="ws-empty-glyph">⚿</span>
        <span>Sign in to see your render library.</span>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="ws-empty">
        <span className="ws-empty-glyph">▦</span>
        <span>No renders yet — submit one from the Workspace.</span>
      </div>
    );
  }

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">Library</h2>
          <p className="ws-sub">{items.length} render{items.length === 1 ? "" : "s"} · most recent first</p>
        </div>
      </header>
      <div className="ws-queue-grid">
        {items.map((j) => (
          <JobCard key={j.id} job={j} onRefresh={() => setPollKey((k) => k + 1)} />
        ))}
      </div>
    </div>
  );
}
