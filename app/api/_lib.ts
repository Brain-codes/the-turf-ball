/**
 * Shared bits for the two Vercel functions. These only exist for crawlers and
 * link previews (Google, WhatsApp, X), which read the HTML before any
 * JavaScript runs. Visitors get the same single-page app either way.
 */

export const SITE_URL = (process.env.VITE_SITE_URL || 'https://the-turf-ball.vercel.app').replace(/\/$/, '')
const FUNCTIONS_URL = (process.env.VITE_FUNCTIONS_URL || '').replace(/\/$/, '')
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''

/** GET from the `public` Edge Function. Returns null on any failure. */
export async function publicApi<T>(path: string): Promise<T | null> {
  if (!FUNCTIONS_URL || !ANON_KEY) return null
  try {
    const res = await fetch(`${FUNCTIONS_URL}/public/${path}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { success: boolean; data: T | null }
    return body.success ? body.data : null
  } catch {
    return null
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
