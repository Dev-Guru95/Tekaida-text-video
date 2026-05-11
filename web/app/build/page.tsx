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
