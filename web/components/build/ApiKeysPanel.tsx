"use client";

import { useEffect, useState } from "react";

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function ApiKeysPanel() {
  const [items, setItems] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ plaintext: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const r = await fetch("/api/build/api-keys", { cache: "no-store" });
    const d = await r.json();
    setItems(d.items ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const r = await fetch("/api/build/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "default" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setJustCreated({ plaintext: d.plaintext, prefix: d.prefix });
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this API key? Active integrations will stop working.")) return;
    await fetch(`/api/build/api-keys?id=${id}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">API access</h2>
          <p className="ws-sub">
            Programmatic access — submit renders from your own backend, Zapier, n8n, etc. POST to{" "}
            <code>/api/v1/renders</code> with <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
        </div>
      </header>

      <form className="proj-create" onSubmit={onCreate}>
        <input
          className="ws-input"
          placeholder="Key name (e.g. n8n production)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>
      {error && <div className="ws-error">{error}</div>}

      {justCreated && (
        <div className="key-banner">
          <strong>Copy your token now — it won't be shown again.</strong>
          <code className="key-token">{justCreated.plaintext}</code>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => navigator.clipboard.writeText(justCreated.plaintext)}
          >
            Copy
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setJustCreated(null)}
          >
            I have saved it
          </button>
        </div>
      )}

      <h3 className="ws-h3">Existing keys</h3>
      {loading ? (
        <div className="ws-empty"><span className="pulse" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="ws-empty">
          <span className="ws-empty-glyph">⌘</span>
          <span>No keys yet.</span>
        </div>
      ) : (
        <table className="key-table">
          <thead>
            <tr>
              <th>name</th>
              <th>prefix</th>
              <th>last used</th>
              <th>created</th>
              <th>state</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td><code>{k.prefix}…</code></td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}</td>
                <td>{new Date(k.created_at).toLocaleDateString()}</td>
                <td className={k.revoked_at ? "key-revoked" : "key-active"}>
                  {k.revoked_at ? "revoked" : "active"}
                </td>
                <td>
                  {!k.revoked_at && (
                    <button type="button" className="btn ghost sm" onClick={() => revoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="ws-h3">Quickstart</h3>
      <pre className="api-snippet">
{`curl -X POST https://yourdomain.com/api/v1/renders \\
  -H "Authorization: Bearer tk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "a lone astronaut walking across martian dunes at dawn",
    "provider": "seedance",
    "aspect": "16:9",
    "duration": 5,
    "resolution": "720p",
    "cameraSlug": "dolly-in",
    "motionSlug": "natural",
    "styleSlug": "cinematic"
  }'`}
      </pre>
    </div>
  );
}
