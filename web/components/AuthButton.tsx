"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthDialog } from "./AuthDialog";

/**
 * Header sign-in widget.
 *  - Supabase not configured  → small "auth not configured" hint (was: silent
 *                               null — that made env-var problems on the
 *                               deployed host invisible)
 *  - Configured + signed out  → "Sign in" button that opens AuthDialog
 *  - Configured + signed in   → email + "Sign out" button
 *
 * `onUserChange` is held in a ref so the auth subscription effect runs once
 * (passing it directly in deps caused an infinite re-render loop earlier).
 */
export function AuthButton({ onUserChange }: { onUserChange?: (u: User | null) => void }) {
  const [client] = useState(() => createSupabaseBrowserClient());
  const [user, setUser] = useState<User | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onUserChangeRef = useRef(onUserChange);
  useEffect(() => {
    onUserChangeRef.current = onUserChange;
  }, [onUserChange]);

  useEffect(() => {
    if (!client) return;
    client.auth.getUser().then(({ data }) => {
      setUser(data.user);
      onUserChangeRef.current?.(data.user);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      setUser(next);
      onUserChangeRef.current?.(next);
      // Auto-close the dialog the moment auth completes
      if (next) setDialogOpen(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [client]);

  if (!client) {
    return (
      <div
        className="auth-row auth-disabled"
        title="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your hosting environment, then rebuild."
      >
        <span className="auth-status">sign-in disabled · Supabase env not set</span>
      </div>
    );
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  if (user) {
    const display =
      (user.user_metadata as { display_name?: string } | null)?.display_name ?? user.email;
    return (
      <div className="auth-row">
        <span className="auth-email" title={user.email ?? undefined}>
          {display}
        </span>
        <button type="button" className="btn ghost sm" onClick={signOut}>
          sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-row">
      <button type="button" className="btn sm" onClick={() => setDialogOpen(true)}>
        Sign in
      </button>
      <AuthDialog client={client} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
