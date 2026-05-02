/**
 * Centralized Supabase configuration. Returns null when the required env vars
 * are missing — the rest of the codebase checks for null and degrades to
 * "anonymous, no memory" mode rather than crashing. This is the feature flag.
 */

export function supabaseEnv():
  | { url: string; anonKey: string; serviceRoleKey: string | undefined }
  | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return {
    url,
    anonKey,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function isSupabaseEnabled(): boolean {
  return supabaseEnv() !== null;
}
