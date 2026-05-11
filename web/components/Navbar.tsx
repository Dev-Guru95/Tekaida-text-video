"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthDialog } from "./AuthDialog";

/**
 * Top-level navigation. Replaces the inline header that used to live in
 * page.tsx. Renders the brand mark, the workspace tagline, a Build CTA that
 * routes to the cinematic generation dashboard, and Sign in / Sign Up auth
 * controls. The Sign Up button opens AuthDialog directly on the create-account
 * tab so the funnel is one click shorter than "Sign in → switch tab".
 */
export function Navbar({
  onUserChange,
  showBuildCta = true,
  active,
}: {
  onUserChange?: (u: User | null) => void;
  showBuildCta?: boolean;
  active?: "home" | "build";
}) {
  const [client] = useState(() => createSupabaseBrowserClient());
  const [user, setUser] = useState<User | null>(null);
  // `authChecked` lets us suppress the "Sign in / Sign Up" buttons during the
  // brief window between mount and the first getUser() resolving — otherwise
  // every navigation from / to /build (or vice versa) flashes signed-out UI
  // for a few hundred ms even when the user is logged in.
  const [authChecked, setAuthChecked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"signin" | "signup">("signin");

  const onUserChangeRef = useRef(onUserChange);
  useEffect(() => {
    onUserChangeRef.current = onUserChange;
  }, [onUserChange]);

  useEffect(() => {
    if (!client) {
      setAuthChecked(true);
      return;
    }
    // getSession() reads from the local cookie/storage cache synchronously
    // where possible and resolves much faster than getUser() (which hits the
    // network). We use getSession for the first paint, then getUser to
    // validate. Either signal flips authChecked.
    client.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthChecked(true);
      onUserChangeRef.current?.(data.session?.user ?? null);
    });
    client.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthChecked(true);
      onUserChangeRef.current?.(data.user);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      setUser(next);
      setAuthChecked(true);
      onUserChangeRef.current?.(next);
      if (next) setDialogOpen(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [client]);

  const openDialog = (tab: "signin" | "signup") => {
    setDialogTab(tab);
    setDialogOpen(true);
  };

  return (
    <header className="brand">
      <Link href="/" className="brand-link">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#7c8cff" />
                <stop offset="1" stopColor="#3ddae0" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="28" height="28" rx="7" stroke="url(#g)" strokeWidth="2" />
            <path d="M11 11h10v3h-3.5v9h-3v-9H11z" fill="url(#g)" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>Tekaida</h1>
          <span className="brand-sub">cinematic AI studio</span>
        </div>
      </Link>

      <nav className="brand-nav">
        <Link
          href="/"
          className={`nav-link ${active === "home" ? "active" : ""}`}
        >
          Studio
        </Link>
        {showBuildCta && (
          <Link
            href="/build"
            className={`btn build-cta ${active === "build" ? "active" : ""}`}
            aria-label="Open the cinematic Build workspace"
          >
            <span className="build-cta-dot" aria-hidden="true" />
            Build
          </Link>
        )}
      </nav>

      <div className="brand-spacer" />

      {client ? (
        !authChecked ? (
          // Loading placeholder — same vertical space, no signed-out flash.
          <div className="auth-row auth-loading" aria-hidden="true">
            <span className="auth-status">·</span>
          </div>
        ) : user ? (
          <div className="auth-row">
            <span
              className="auth-email"
              title={user.email ?? undefined}
            >
              {(user.user_metadata as { display_name?: string } | null)?.display_name ?? user.email}
            </span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => client.auth.signOut()}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="auth-row">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => openDialog("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => openDialog("signup")}
            >
              Sign Up
            </button>
            <AuthDialog
              client={client}
              open={dialogOpen}
              initialTab={dialogTab}
              onClose={() => setDialogOpen(false)}
            />
          </div>
        )
      ) : (
        <div
          className="auth-row auth-disabled"
          title="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your hosting environment, then rebuild."
        >
          <span className="auth-status">sign-in disabled · Supabase env not set</span>
        </div>
      )}

      <span className="brand-tag">v0.5 · build</span>
    </header>
  );
}
