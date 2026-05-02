"use client";

import { useCallback, useEffect, useState } from "react";

export interface HistoryItem {
  id: string;
  output_type: "video" | "image" | "deck" | "infographic" | "book";
  title: string | null;
  concept: string;
  provider: string | null;
  output_url: string | null;
  created_at: string;
}

interface HistoryResponse {
  enabled: boolean;
  signedIn?: boolean;
  items: HistoryItem[];
}

const TYPE_LABEL: Record<HistoryItem["output_type"], string> = {
  video: "Video",
  image: "Image",
  deck: "Deck",
  infographic: "Infographic",
  book: "Book",
};

export function HistorySidebar({
  refreshKey,
  onRestore,
}: {
  refreshKey: number;
  onRestore: (item: HistoryItem) => void;
}) {
  const [state, setState] = useState<HistoryResponse>({ enabled: true, items: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/history", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as HistoryResponse;
      setState(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  if (!state.enabled) return null;

  return (
    <aside className="history">
      <div className="history-header">
        <h3>Recent</h3>
        <span className="history-count">
          {state.signedIn ? `${state.items.length}` : "sign in"}
        </span>
      </div>
      {!state.signedIn ? (
        <p className="history-empty">Sign in (top right) to keep your generations across sessions.</p>
      ) : loading ? (
        <p className="history-empty">loading…</p>
      ) : state.items.length === 0 ? (
        <p className="history-empty">No generations yet — they'll show up here as you create them.</p>
      ) : (
        <ul className="history-list">
          {state.items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="history-item"
                onClick={() => onRestore(it)}
                title={it.concept}
              >
                <span className={`history-type history-type-${it.output_type}`}>
                  {TYPE_LABEL[it.output_type]}
                </span>
                <span className="history-title">{it.title ?? it.concept.slice(0, 40)}</span>
                <span className="history-time">
                  {new Date(it.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
