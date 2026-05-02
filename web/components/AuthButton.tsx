"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Sign-in / sign-out widget. Three states:
 *  - Supabase not configured → renders nothing (memory feature is off)
 *  - Configured + signed out → email input + "Send magic link"
 *  - Configured + signed in  → email + "Sign out" button
 */
export function AuthButton({ onUserChange }: { onUserChange?: (u: User | null) => void }) {
  const [client] = useState(() => createSupabaseBrowserClient());
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (!client) return;
    client.auth.getUser().then(({ data }) => {
      setUser(data.user);
      onUserChange?.(data.user);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      onUserChange?.(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [client, onUserChange]);

  if (!client) return null;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!client || !email.trim()) return;
    setStatus("sending…");
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
      },
    });
    setStatus(error ? `error: ${error.message}` : "check your email for the link");
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  if (user) {
    return (
      <div className="auth-row">
        <span className="auth-email" title={user.email ?? undefined}>
          {user.email}
        </span>
        <button type="button" className="btn ghost sm" onClick={signOut}>
          sign out
        </button>
      </div>
    );
  }

  return (
    <form className="auth-row" onSubmit={sendMagicLink}>
      <input
        type="email"
        required
        placeholder="your email for magic-link sign-in"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="auth-input"
      />
      <button type="submit" className="btn sm">sign in</button>
      {status && <span className="auth-status">{status}</span>}
    </form>
  );
}
