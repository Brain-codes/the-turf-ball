import { getSupabase } from '@/lib/supabase'

/**
 * The single door to the backend. Every request in the app goes through here:
 * it attaches the bearer token and active group, unwraps the standard envelope,
 * and throws a typed error so callers never inspect `success` by hand.
 */

const BASE = import.meta.env.VITE_FUNCTIONS_URL

export interface Envelope<T> {
  success: boolean
  message: string
  data: T | null
  meta: Record<string, unknown>
  errors: Record<string, string[]> | string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors: Record<string, string[]> | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The message for a specific form field, if the server flagged one. */
  field(name: string): string | undefined {
    return this.fieldErrors?.[name]?.[0]
  }
}

let activeOrgId: string | null = localStorage.getItem('ttb.org')

export function setActiveOrg(id: string | null) {
  activeOrgId = id
  if (id) localStorage.setItem('ttb.org', id)
  else localStorage.removeItem('ttb.org')
}

export function getActiveOrg(): string | null {
  return activeOrgId
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  /** Public endpoints must not send a token. */
  anonymous?: boolean
  signal?: AbortSignal
}

export interface Result<T> {
  data: T
  message: string
  meta: Record<string, unknown>
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
  const { method = 'GET', body, query, anonymous = false, signal } = options

  const url = new URL(`${BASE}/${path.replace(/^\//, '')}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  // Supabase's gateway rejects any request without an Authorization header
  // before it ever reaches the function — including genuinely public ones. So
  // the anon key is the baseline here, and a signed-in user's token replaces
  // it. Without this, the share page and sign-up would 401 at the edge.
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  }

  if (!anonymous) {
    const supabase = await getSupabase()
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
    if (activeOrgId) headers['X-Organization-Id'] = activeOrgId
  }

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    // Distinguishing "you are offline" from "the server broke" matters at a
    // pitch, where the answer is usually the former and usually temporary.
    throw new ApiError('No connection. Check your signal and try again.', 0)
  }

  let payload: Envelope<T>
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('The server sent something unexpected.', response.status)
  }

  if (!response.ok || !payload.success) {
    const fieldErrors =
      payload.errors && typeof payload.errors === 'object'
        ? (payload.errors as Record<string, string[]>)
        : null
    throw new ApiError(payload.message || 'Something went wrong', response.status, fieldErrors)
  }

  return {
    data: payload.data as T,
    message: payload.message,
    meta: payload.meta ?? {},
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'GET', query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
  /** For the share page, which has no session. */
  public: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query, anonymous: true }),
}
