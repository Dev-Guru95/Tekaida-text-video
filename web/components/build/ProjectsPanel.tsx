"use client";

import { useEffect, useState } from "react";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export function ProjectsPanel() {
  const [items, setItems] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const r = await fetch("/api/build/projects", { cache: "no-store" });
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
    if (!name.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/build/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setName("");
      setDescription("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ws-root">
      <header className="ws-header">
        <div>
          <h2 className="ws-title">Projects</h2>
          <p className="ws-sub">
            One project per client engagement. Renders submitted under a project show in the project's tab,
            and team members you invite can collaborate.
          </p>
        </div>
      </header>

      <form className="proj-create" onSubmit={onCreate}>
        <input
          className="ws-input"
          placeholder="Project name (e.g. Acme Q3 launch)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="ws-input"
          placeholder="Short description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="btn" type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create project"}
        </button>
      </form>
      {error && <div className="ws-error">{error}</div>}

      {loading ? (
        <div className="ws-empty"><span className="pulse" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="ws-empty">
          <span className="ws-empty-glyph">▣</span>
          <span>No projects yet — create one above.</span>
        </div>
      ) : (
        <div className="proj-grid">
          {items.map((p) => (
            <article key={p.id} className="proj-card">
              <h3 className="proj-name">{p.name}</h3>
              {p.description && <p className="proj-desc">{p.description}</p>}
              <footer className="proj-foot">
                <span>updated {new Date(p.updated_at).toLocaleDateString()}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
