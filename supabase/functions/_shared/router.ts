/**
 * Routing + the single error boundary. rule2.txt §5–7.
 *
 * index.ts detects method and path segments and delegates. All business logic
 * lives in handlers/. This file exists so that mapping is written once rather
 * than twelve times.
 */

import { handlePreflight } from './cors.ts'
import { errorResponse } from './response.ts'
import { AppError } from './errors.ts'
import { makeLogger, type Logger } from './log.ts'
import { serviceClient, type SupabaseClient } from './db.ts'

export interface Ctx {
  req: Request
  db: SupabaseClient
  /** Path segments AFTER the function name. /players/abc/stats -> ['abc','stats'] */
  segments: string[]
  query: URLSearchParams
  log: Logger
  body: <T>() => Promise<T>
}

export type Handler = (ctx: Ctx) => Promise<Response>

/** method -> [segment-count-pattern, handler]. Patterns use ':' for a param. */
export type Routes = Record<string, Record<string, Handler>>

/**
 * Match a concrete path against a route pattern.
 * pattern ''      matches []           (collection root)
 * pattern ':id'   matches ['abc']
 * pattern ':id/stats' matches ['abc','stats']
 * pattern 'bulk'  matches ['bulk'] — literals win over params.
 */
function matchRoute(routes: Record<string, Handler>, segments: string[]): Handler | null {
  const path = segments.join('/')
  if (routes[path]) return routes[path]

  const candidates = Object.keys(routes).filter((p) => {
    const parts = p === '' ? [] : p.split('/')
    if (parts.length !== segments.length) return false
    return parts.every((part, i) => part.startsWith(':') || part === segments[i])
  })

  if (candidates.length === 0) return null
  // Prefer the pattern with the most literal segments, so 'bulk' beats ':id'.
  candidates.sort(
    (a, b) =>
      b.split('/').filter((s) => !s.startsWith(':')).length -
      a.split('/').filter((s) => !s.startsWith(':')).length,
  )
  return routes[candidates[0]]
}

export function createRouter(functionName: string, routes: Routes) {
  return async (req: Request): Promise<Response> => {
    const preflight = handlePreflight(req)
    if (preflight) return preflight

    const requestId = crypto.randomUUID()
    const url = new URL(req.url)

    // Strip /functions/v1/<functionName> from the front.
    const all = url.pathname.split('/').filter(Boolean)
    const fnIndex = all.indexOf(functionName)
    const segments = fnIndex >= 0 ? all.slice(fnIndex + 1) : []

    const log = makeLogger(requestId, `${req.method} /${functionName}/${segments.join('/')}`)

    try {
      const methodRoutes = routes[req.method]
      if (!methodRoutes) return errorResponse('Method not allowed', null, 405)

      const handler = matchRoute(methodRoutes, segments)
      if (!handler) return errorResponse('Endpoint not found', null, 404)

      let cachedBody: unknown
      let bodyRead = false

      const ctx: Ctx = {
        req,
        db: serviceClient(),
        segments,
        query: url.searchParams,
        log,
        body: async <T>() => {
          if (!bodyRead) {
            bodyRead = true
            try {
              cachedBody = await req.json()
            } catch {
              cachedBody = {}
            }
          }
          return cachedBody as T
        },
      }

      return await handler(ctx)
    } catch (err) {
      if (err instanceof AppError) {
        log.warn(err.message, { status: err.status })
        return errorResponse(err.message, err.errors, err.status, { request_id: requestId })
      }
      const message = err instanceof Error ? err.message : String(err)
      log.error('Unhandled error', { error: message })
      return errorResponse(
        'Something went wrong on our side. Please try again.',
        null,
        500,
        { request_id: requestId },
      )
    }
  }
}
