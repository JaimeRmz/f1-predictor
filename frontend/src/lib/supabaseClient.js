import { createClient } from "@supabase/supabase-js";

// Both values below are public by design — the project URL and the publishable
// (anon) key are meant to ship in the browser bundle. Row-level security on the
// Postgres side is what actually gates data, not secrecy of this key, so these
// are safe to commit and need no .env indirection.
const SUPABASE_URL = "https://ykpkieabxvipkyyynypr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FDV2saSQ_F129iwVkHl4nA_-avf1hA6";

// persistSession keeps the anonymous user stable across reloads (same user_id →
// their saved picks survive a refresh); autoRefreshToken keeps that JWT alive.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
