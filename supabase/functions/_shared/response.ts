/**
 * The ONLY place a Response is constructed. rule2.txt §7–8.
 *
 * Every endpoint in this project returns the identical envelope, success or
 * failure. A handler that builds a Response by hand is a bug.
 */

import { corsHeaders } from './cors.ts'

export interface Envelope<T = unknown> {
  success: boolean
  message: string
  data: T | null
  meta: Record<string, unknown>
  errors: Record<string, string[]> | string | null
}

export interface PageMeta extends Record<string, number> {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export function successResponse<T>(
  data: T = {} as T,
  message = 'Request successful',
  meta: Record<string, unknown> = {},
  status = 200,
): Response {
  const body: Envelope<T> = { success: true, message, data, meta, errors: null }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(
  message = 'Request failed',
  errors: Record<string, string[]> | string | null = null,
  status = 400,
  meta: Record<string, unknown> = {},
): Response {
  const body: Envelope<null> = { success: false, message, data: null, meta, errors }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function paginate(page: number, perPage: number, total: number): PageMeta {
  return {
    page,
    per_page: perPage,
    total,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
  }
}
