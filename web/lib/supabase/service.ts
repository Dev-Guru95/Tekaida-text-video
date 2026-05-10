/**
 * Service-role Supabase client. Use ONLY from server code that needs to bypass
 * RLS — queue worker, billing webhook, admin endpoints. Never returned to the
 * browser, never imported from a Client Component.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set, so callers can fail
 * loudly with a 503 instead of silently using an under-privileged client.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./config";

export function createSupabaseServiceClient(): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env || !env.serviceRoleKey) return null;
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
