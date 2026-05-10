"use client";

import { useEffect, useState } from "react";

interface AdminData {
  queue: { queued: number; processing: number; done24h: number; errors24h: number };
  recentErrors: { id: string; user_id: string; provider: string; error: string | null; created_at: string }[];
  topSpenders: { user_id: string; lifetime_topup: number; balance: number }[];
}

export function AdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/build/admin", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 403) {
          setAllowed(false);
          return null;
        }
        if (r.status === 401) {
          setAllowed(false);
          return null;
        }
        const d = await r.json();
        if (!r.ok) {
          setError(d.error ?? `HTTP ${r.status}`);
          setAllowed(false);
          return null;
        }
        setAllowed(true);
        setData(d);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (allowed === false) {
    return (
      <div className="ws-empty">
        <span className="ws-empty-glyph">⚿</span>
        <span>
          Admin only. Add your user to <code>profiles_admin</code> in Supabase to unlock.
          {error ? <><br /><em>{error}</em></> : null}
        </span>
      </div>
    );
  }
  if (!data) {
    return <div className="ws-empty"><span className="pulse" /> Loading admin metrics…</div>;
  }

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">Admin</h2>
          <p className="ws-sub">Operations overview — queue depth, recent failures, top tenants.</p>
        </div>
      </header>

      <div className="admin-stat-grid">
        <Stat label="queued" value={data.queue.queued} accent="warn" />
        <Stat label="processing" value={data.queue.processing} accent="info" />
        <Stat label="done · 24h" value={data.queue.done24h} accent="success" />
        <Stat label="errors · 24h" value={data.queue.errors24h} accent="danger" />
      </div>

      <h3 className="ws-h3">Recent failures</h3>
      {data.recentErrors.length === 0 ? (
        <div className="ws-empty"><span className="ws-empty-glyph">·</span><span>No errors in the recent window.</span></div>
      ) : (
        <table className="key-table">
          <thead>
            <tr><th>when</th><th>provider</th><th>error</th><th>user</th></tr>
          </thead>
          <tbody>
            {data.recentErrors.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleTimeString()}</td>
                <td>{e.provider}</td>
                <td><code>{e.error ?? "—"}</code></td>
                <td><code>{e.user_id.slice(0, 8)}…</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="ws-h3">Top tenants by lifetime spend</h3>
      {data.topSpenders.length === 0 ? (
        <div className="ws-empty"><span className="ws-empty-glyph">·</span><span>No paid customers yet.</span></div>
      ) : (
        <table className="key-table">
          <thead>
            <tr><th>user</th><th>lifetime cr</th><th>balance</th></tr>
          </thead>
          <tbody>
            {data.topSpenders.map((u) => (
              <tr key={u.user_id}>
                <td><code>{u.user_id.slice(0, 8)}…</code></td>
                <td>{u.lifetime_topup.toLocaleString()}</td>
                <td>{u.balance.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "warn" | "info" | "success" | "danger" }) {
  return (
    <div className={`admin-stat admin-stat-${accent}`}>
      <span className="admin-stat-label">{label}</span>
      <span className="admin-stat-value">{value}</span>
    </div>
  );
}
