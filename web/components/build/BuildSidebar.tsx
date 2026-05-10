"use client";

export type BuildSection =
  | "workspace"
  | "library"
  | "projects"
  | "billing"
  | "api"
  | "admin"
  | "settings";

interface NavItem {
  key: BuildSection;
  label: string;
  hint: string;
  icon: string;     // simple unicode glyph; designers can swap to a real icon set later
}

const NAV: NavItem[] = [
  { key: "workspace", label: "Workspace",   hint: "prompt → render", icon: "▶" },
  { key: "library",   label: "Library",     hint: "your renders",     icon: "▤" },
  { key: "projects",  label: "Projects",    hint: "client folders",   icon: "▣" },
  { key: "billing",   label: "Billing",     hint: "credits + Stripe", icon: "✦" },
  { key: "api",       label: "API access",  hint: "tokens + docs",    icon: "⌘" },
  { key: "admin",     label: "Admin",       hint: "queue + tenants",  icon: "◉" },
  { key: "settings",  label: "Settings",    hint: "preferences",      icon: "✎" },
];

/**
 * Left rail navigation for the Build workspace. Each section maps to a panel
 * in /build/page.tsx. The sidebar collapses to a top horizontal bar on
 * narrow screens (handled in build.css with a media query).
 */
export function BuildSidebar({
  active,
  onChange,
  balance,
  signedIn,
}: {
  active: BuildSection;
  onChange: (s: BuildSection) => void;
  balance: number;
  signedIn: boolean;
}) {
  return (
    <aside className="build-sidebar" aria-label="Build navigation">
      <div className="bs-section">
        <div className="bs-credits">
          <span className="bs-credits-label">{signedIn ? "credits" : "demo mode"}</span>
          <span className="bs-credits-value">{signedIn ? balance.toLocaleString() : "—"}</span>
          {signedIn && balance < 100 && (
            <button
              type="button"
              className="btn sm bs-topup"
              onClick={() => onChange("billing")}
            >
              Top up
            </button>
          )}
        </div>
      </div>

      <nav className="bs-nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            className={`bs-nav-item ${active === n.key ? "active" : ""}`}
            onClick={() => onChange(n.key)}
            title={n.hint}
          >
            <span className="bs-nav-icon" aria-hidden="true">{n.icon}</span>
            <span className="bs-nav-label">{n.label}</span>
            <span className="bs-nav-hint">{n.hint}</span>
          </button>
        ))}
      </nav>

      <div className="bs-footer">
        <span className="bs-version">SeaDance 2.0 · v0.5</span>
        <a className="bs-doc" href="/api/v1/renders" target="_blank" rel="noreferrer">
          API docs ↗
        </a>
      </div>
    </aside>
  );
}
