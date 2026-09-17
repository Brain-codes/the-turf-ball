/**
 * GET /admin/overview — platform totals and 30-day sign-up trend.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireSuperAdmin } from '../../_shared/auth.ts'

export async function overview(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const db = ctx.db
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const count = async (table: string, apply?: (q: any) => any) => {
    // deno-lint-ignore no-explicit-any
    let q: any = db.from(table).select('*', { count: 'exact', head: true })
    if (apply) q = apply(q)
    const { count: n, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    return n ?? 0
  }

  const [
    users, newUsers7, groups, suspended, players, sessions, liveSessions,
    matches, goals, assists, newMessages, recentSignups, recentGroups,
  ] = await Promise.all([
    count('profiles', (q) => q.is('deleted_at', null)),
    count('profiles', (q) => q.is('deleted_at', null).gte('created_at', since7)),
    count('organizations', (q) => q.is('deleted_at', null)),
    count('organizations', (q) => q.is('deleted_at', null).eq('status', 'archived')),
    count('players', (q) => q.neq('status', 'guest')),
    count('sessions'),
    count('sessions', (q) => q.eq('status', 'live')),
    count('matches'),
    count('match_events', (q) => q.eq('event_type', 'goal').is('voided_at', null)),
    count('match_events', (q) => q.eq('event_type', 'assist').is('voided_at', null)),
    count('contact_messages', (q) => q.eq('status', 'new')),
    db.from('profiles').select('created_at').gte('created_at', since30).limit(5000),
    db.from('organizations').select('created_at').gte('created_at', since30).limit(5000),
  ])

  // One bucket per day for the last 30 days, oldest first.
  const days: { date: string; users: number; groups: number }[] = []
  for (let i = 29; i >= 0; i--) {
    days.push({ date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), users: 0, groups: 0 })
  }
  const byDate = new Map(days.map((d) => [d.date, d]))
  for (const r of recentSignups.data ?? []) byDate.get(String(r.created_at).slice(0, 10)) && byDate.get(String(r.created_at).slice(0, 10))!.users++
  for (const r of recentGroups.data ?? []) byDate.get(String(r.created_at).slice(0, 10)) && byDate.get(String(r.created_at).slice(0, 10))!.groups++

  return successResponse({
    totals: { users, new_users_7d: newUsers7, groups, suspended_groups: suspended, players, sessions, live_sessions: liveSessions, matches, goals, assists, new_messages: newMessages },
    trend: days,
  })
}
