import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase client exists in this app for ONE purpose: authentication.
 * rule2.txt §1 forbids touching tables from the client, so there is no
 * `.from()` call anywhere in this codebase. All data goes through
 * services/client.ts -> Edge Functions.
 *
 * It is loaded dynamically rather than imported at the top level, because the
 * public share page has no session and must not pay ~60KB to render a league
 * table for someone who tapped a WhatsApp link on mobile data.
 */

let clientPromise: Promise<SupabaseClient> | null = null

export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        },
      ),
    )
  }
  return clientPromise
}

/** True when a session token is already in storage — no network, no library. */
export function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) return true
    }
  } catch {
    /* Storage can be unavailable in private mode; treat that as signed out. */
  }
  return false
}
