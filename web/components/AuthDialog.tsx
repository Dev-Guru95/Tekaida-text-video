"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tab = "signin" | "signup";

/**
 * Build the post-confirmation redirect URL passed to Supabase. We include
 * `next=<current path>` so the user lands back on whichever page they were
 * on (typically `/build`) after clicking the email link, instead of always
 * landing on `/`.
 */
function buildCallbackUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const next = window.location.pathname + window.location.search;
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * Modal sign-in / sign-up dialog. Supports:
 *   - Email + password sign in
 *   - Email + password sign up (with optional display name)
 *   - Magic-link fallback ("send me a sign-in link instead")
 *   - Forgot-password reset link
 *
 * Closes on Esc, click outside the card, or successful auth state change.
 */
export function AuthDialog({
  client,
  open,
  onClose,
  initialTab = "signin",
}: {
  client: SupabaseClient;
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // When the parent toggles the requested tab (e.g. user clicked "Sign Up"
  // after the dialog was last closed in sign-in mode), reset to the new tab.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Focus the email field whenever the dialog opens
  useEffect(() => {
    if (open) {
      setInfo(null);
      setErrorMsg(null);
      // Small delay so the focus lands after the dialog mounts
      const t = setTimeout(() => emailInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, tab]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (tab === "signup") {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: buildCallbackUrl(),
            data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
          },
        });
        if (error) {
          setErrorMsg(error.message);
        } else if (data.session) {
          // Email confirmation disabled in Supabase project — signed in directly.
          onClose();
        } else {
          setInfo(
            "Account created. Check your email for a confirmation link, then come back and sign in.",
          );
        }
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setErrorMsg(error.message);
        } else {
          onClose();
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setErrorMsg("Enter your email above first.");
      return;
    }
    setErrorMsg(null);
    setInfo(null);
    setSubmitting(true);
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: buildCallbackUrl(),
      },
    });
    setSubmitting(false);
    if (error) setErrorMsg(error.message);
    else setInfo("Magic link sent — check your inbox.");
  }

  async function sendPasswordReset() {
    if (!email.trim()) {
      setErrorMsg("Enter your email above first.");
      return;
    }
    setErrorMsg(null);
    setInfo(null);
    setSubmitting(true);
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: buildCallbackUrl(),
    });
    setSubmitting(false);
    if (error) setErrorMsg(error.message);
    else setInfo("Password reset link sent — check your inbox.");
  }

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-dialog-title"
      onClick={onClose}
    >
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "signin"}
            className={`auth-tab ${tab === "signin" ? "active" : ""}`}
            onClick={() => setTab("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "signup"}
            className={`auth-tab ${tab === "signup" ? "active" : ""}`}
            onClick={() => setTab("signup")}
          >
            Create account
          </button>
        </div>

        <h2 id="auth-dialog-title" className="auth-title">
          {tab === "signin" ? "Welcome back" : "Create your Tekaida account"}
        </h2>
        <p className="auth-sub">
          {tab === "signin"
            ? "Sign in to access your history and continue where you left off."
            : "Save your generations and pick up across sessions."}
        </p>

        <form onSubmit={onSubmit} className="auth-form">
          {tab === "signup" && (
            <label className="auth-field">
              <span>display name <em>(optional)</em></span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="how should we greet you?"
                autoComplete="name"
              />
            </label>
          )}
          <label className="auth-field">
            <span>email</span>
            <input
              ref={emailInputRef}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="auth-field">
            <span>password</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === "signup" ? "at least 6 characters" : "••••••••"}
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
            />
          </label>

          {errorMsg && <div className="auth-error">{errorMsg}</div>}
          {info && <div className="auth-info">{info}</div>}

          <button type="submit" className="btn auth-submit" disabled={submitting}>
            {submitting
              ? "working…"
              : tab === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>

        <div className="auth-alt">
          <button
            type="button"
            className="btn ghost sm auth-alt-btn"
            onClick={sendMagicLink}
            disabled={submitting}
          >
            ✉ Send me a magic link instead
          </button>
          {tab === "signin" && (
            <button
              type="button"
              className="auth-link"
              onClick={sendPasswordReset}
              disabled={submitting}
            >
              Forgot your password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
