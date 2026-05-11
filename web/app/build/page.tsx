"use client";

import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { BuildSidebar, type BuildSection } from "@/components/build/BuildSidebar";
import { WorkspacePanel } from "@/components/build/WorkspacePanel";
import { LibraryPanel } from "@/components/build/LibraryPanel";
import { ProjectsPanel } from "@/components/build/ProjectsPanel";
import { BillingPanel } from "@/components/build/BillingPanel";
import { ApiKeysPanel } from "@/components/build/ApiKeysPanel";
import { AdminPanel } from "@/components/build/AdminPanel";
import { SettingsPanel } from "@/components/build/SettingsPanel";

/**
 * Cinematic Build workspace. The whole page is a single client component
 * that owns navigation between sections (Workspace / Library / Projects /
 * Billing / API / Admin / Settings). Each section is its own panel
 * component so the page stays scannable.
 *
 * State scoped here (kept in URL hash so bookmarks land on the right tab):
 *   - active section
 *   - credit balance summary (refreshes after a job submits or top-up succeeds)
 */
const ADMIN_ONLY_SECTIONS: BuildSection[] = ["admin", "api"];

export default function BuildPage() {
  const [section, setSection] = useState<BuildSection>("workspace");
  const [balance, setBalance] = useState<number>(0);
  const [signedIn, setSignedIn] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [creditsKey, setCreditsKey] = useState(0);
  const [authError, setAuthError] = useState<{ code: string; description: string } | null>(null);

  // Read auth-callback errors from the query string. Lives on /build because
  // that's where most signups happen — the buildCallbackUrl() helper in
  // AuthDialog pins the post-confirmation redirect to the page that opened
  // the dialog. If the user signed up on /, they'll see the same banner there
  // (we surface it via a generic ?auth_error reader once we add it to / too).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) {
      setAuthError({
        code: err,
        description: params.get("auth_error_description") ?? "",
      });
      // Strip the params so a page reload doesn't keep re-showing the banner.
      params.delete("auth_error");
      params.delete("auth_error_description");
      const rest = params.toString();
      const cleaned = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", cleaned);
    }
  }, []);

  // Restore tab from URL hash.
  useEffect(() => {
    const fromHash = (typeof window !== "undefined" ? window.location.hash.slice(1) : "") as BuildSection;
    if (
      ["workspace", "library", "projects", "billing", "api", "admin", "settings"].includes(fromHash)
    ) {
      setSection(fromHash);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const next = `#${section}`;
      if (window.location.hash !== next) window.history.replaceState(null, "", next);
    }
  }, [section]);

  // Pull credit balance + admin status whenever a job is submitted
  // (creditsKey bump) or the user first lands on the page.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/build/credits", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setBalance(typeof d.balance === "number" ? d.balance : 0);
        setSignedIn(Boolean(d.signedIn));
        setIsAdmin(Boolean(d.isAdmin));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [creditsKey]);

  // Guard: if the user is parked on an admin-only section but isn't an admin
  // (e.g. they bookmarked /build#admin), bounce them back to Workspace. This
  // runs whenever isAdmin or section changes — including after sign-out.
  useEffect(() => {
    if (!isAdmin && ADMIN_ONLY_SECTIONS.includes(section)) {
      setSection("workspace");
    }
  }, [isAdmin, section]);

  const refreshCredits = () => setCreditsKey((k) => k + 1);

  return (
    <main className="build-main">
      <Navbar active="build" onUserChange={refreshCredits} />

      {authError && (
        <div className="ws-error" role="alert" style={{ marginTop: 12 }}>
          <strong>Sign-in didn't complete:</strong> {authError.description || authError.code}
          <button
            type="button"
            onClick={() => setAuthError(null)}
            style={{
              float: "right",
              background: "transparent",
              border: 0,
              color: "inherit",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="build-grid">
        <BuildSidebar
          active={section}
          onChange={setSection}
          balance={balance}
          signedIn={signedIn}
          isAdmin={isAdmin}
        />

        <section className="build-canvas">
          {section === "workspace" && (
            <WorkspacePanel onJobSubmitted={refreshCredits} balance={balance} />
          )}
          {section === "library" && <LibraryPanel />}
          {section === "projects" && <ProjectsPanel />}
          {section === "billing" && (
            <BillingPanel onTopupSuccess={refreshCredits} balance={balance} />
          )}
          {/* Admin-only sections are also guarded server-side; the UI gate is
              just to keep the sidebar clean and avoid 403 flashes. */}
          {section === "api" && isAdmin && <ApiKeysPanel />}
          {section === "admin" && isAdmin && <AdminPanel />}
          {section === "settings" && <SettingsPanel />}
        </section>
      </div>
    </main>
  );
}
