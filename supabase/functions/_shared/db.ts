import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Service-role client. Bypasses RLS by design — RLS is deny-all everywhere
 * (see migration 1) and authorization lives in requireMember(), not in the
 * database. This client must never be exposed beyond an Edge Function.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export type { SupabaseClient }
