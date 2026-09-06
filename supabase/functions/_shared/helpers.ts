/** Domain helpers shared across resources. */

import type { SupabaseClient } from './db.ts'
import { notFound, unprocessable } from './errors.ts'

/* ---------------------------------------------------------------------------
 * Periods
 * ------------------------------------------------------------------------- */

export async function openPeriodId(db: SupabaseClient, organizationId: string): Promise<string> {
  const { data, error } = await db.rpc('ensure_open_period', { p_org: organizationId })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * The month a dated thing belongs to — always its OWN date, never "whichever
 * month happens to be open right now". A session played on 3 December belongs
 * to December even if it was created back in August, and the months in between
 * roll forward on their own to make room for it.
 */
export async function periodForDate(
  db: SupabaseClient,
  organizationId: string,
  date: string,
): Promise<string> {
  const { data, error } = await db.rpc('period_for_date', {
    p_org: organizationId,
    p_date: date,
  })
  if (error) throw unprocessable(error.message)
  return data as string
}

/** Resolve the period a request is asking about: explicit id, or the open one. */
export async function resolvePeriod(
  db: SupabaseClient,
  organizationId: string,
  requested?: string | null,
): Promise<{ id: string; label: string; status: string; year: number; month: number }> {
  if (requested) {
    const { data, error } = await db
      .from('periods')
      .select('id, label, status, year, month')
      .eq('id', requested)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw notFound('Month not found')
    return data
  }

  const id = await openPeriodId(db, organizationId)
  const { data, error } = await db
    .from('periods')
    .select('id, label, status, year, month')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Recording into a closed month is refused — that is the whole point of
 * closing. But "not open" covers two different situations and they must not
 * read the same:
 *
 *   * closed_at set  — the month was properly closed, awards and all. Refuse.
 *   * closed_at null — the month exists but has not had its turn yet, because
 *     the month before it is still inside its grace window. Nothing was
 *     "closed" here. Roll the months forward once and look again; if the
 *     previous month is genuinely over, this one opens and recording carries
 *     on without anyone having to do anything.
 */
export async function assertPeriodOpen(db: SupabaseClient, periodId: string): Promise<void> {
  const select = 'status, label, starts_on, closed_at, organization_id'
  let { data, error } = await db.from('periods').select(select).eq('id', periodId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Month not found')

  if (data.status !== 'open' && !data.closed_at) {
    await openPeriodId(db, data.organization_id)
    const retry = await db.from('periods').select(select).eq('id', periodId).maybeSingle()
    if (retry.error) throw new Error(retry.error.message)
    if (retry.data) data = retry.data
  }

  if (data.status !== 'open') {
    throw unprocessable(
      data.closed_at
        ? `${data.label} has been closed. Reopen it first if you need to change it.`
        : `${data.label} hasn't opened yet — the month before it is still running.`,
    )
  }
}

/* ---------------------------------------------------------------------------
 * Punctuality — SPEC.md §9.3
 * ------------------------------------------------------------------------- */

export interface PunctualitySettings {
  early_before_mins: number
  on_time_after_mins: number
  late_after_mins: number
  early_points: number
  on_time_points: number
  late_points: number
  very_late_points: number
}

export type Band = 'early' | 'on_time' | 'late' | 'very_late'

/**
 * Band an arrival against kick-off.
 *   arrived 10+ min before          -> early
 *   up to 5 min after kick-off      -> on_time
 *   5–20 min after                  -> late
 *   more than 20 min after          -> very_late
 * All four windows are organization-configurable.
 */
export function bandArrival(
  arrivedAt: Date,
  kickoffAt: Date,
  s: PunctualitySettings,
): { band: Band; points: number } {
  const minutesLate = (arrivedAt.getTime() - kickoffAt.getTime()) / 60000

  if (minutesLate <= -s.early_before_mins) return { band: 'early', points: s.early_points }
  if (minutesLate <= s.on_time_after_mins) return { band: 'on_time', points: s.on_time_points }
  if (minutesLate <= s.late_after_mins) return { band: 'late', points: s.late_points }
  return { band: 'very_late', points: s.very_late_points }
}

export async function orgSettings(db: SupabaseClient, organizationId: string) {
  const { data, error } = await db
    .from('org_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  if (!data) {
    const { data: created, error: insErr } = await db
      .from('org_settings')
      .insert({ organization_id: organizationId })
      .select('*')
      .single()
    if (insErr) throw new Error(insErr.message)
    return created
  }
  return data
}

/* ---------------------------------------------------------------------------
 * Stats
 * ------------------------------------------------------------------------- */

/** Recompute the cached statistics for a period. Cheap: one scoped aggregate. */
export async function recomputeStats(db: SupabaseClient, periodId: string): Promise<void> {
  const { error } = await db.rpc('recompute_period_stats', { p_period: periodId })
  if (error) throw new Error(error.message)
}

export async function refreshMatchScore(db: SupabaseClient, matchId: string): Promise<void> {
  const { error } = await db.rpc('refresh_match_score', { p_match: matchId })
  if (error) throw new Error(error.message)
}

/**
 * How long after a session ends its recorded events can still be corrected
 * (missing assist, wrong scorer, a card that shouldn't have been given).
 * After this, the session is locked — whatever's recorded stands.
 */
export const EDIT_WINDOW_HOURS = 5

/**
 * True while a match's events can still be written to: either it's still
 * genuinely in progress, or its session ended recently enough to be inside
 * the post-session correction window.
 */
export function editWindowOpen(matchStatus: string, sessionEndedAt: string | null): boolean {
  if (matchStatus === 'live' || matchStatus === 'pending') return true
  if (!sessionEndedAt) return false
  const hoursSince = (Date.now() - new Date(sessionEndedAt).getTime()) / 3_600_000
  return hoursSince <= EDIT_WINDOW_HOURS
}

/**
 * Marks a session as genuinely still active — called on every event write
 * and attendance change. The quiet-session scheduler check reads this to
 * tell "still being played" apart from "nobody's touched it in a while".
 * Best-effort: never let this fail the write it's attached to.
 */
export async function touchSessionActivity(db: SupabaseClient, sessionId: string): Promise<void> {
  await db
    .from('sessions')
    .update({ last_activity_at: new Date().toISOString(), awaiting_confirmation: false })
    .eq('id', sessionId)
    .eq('status', 'live')
}

/* ---------------------------------------------------------------------------
 * Realtime — SPEC.md §12
 *
 * Clients are forbidden from subscribing to table changes (rule2.txt §1), so
 * this publishes to a broadcast channel instead. The payload says only WHAT
 * changed; listeners re-fetch through the public Edge Function. The channel is
 * a notification bus, never a data path.
 * ------------------------------------------------------------------------- */

export async function broadcast(
  db: SupabaseClient,
  organizationId: string,
  periodId: string,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const channel = db.channel(`org:${organizationId}:period:${periodId}`)
    await channel.send({ type: 'broadcast', event, payload })
    await db.removeChannel(channel)
  } catch (err) {
    // A failed notification must never fail the write that triggered it.
    // The organizer's goal is recorded; the public page just refreshes late.
    console.warn('broadcast failed', String(err))
  }
}

/* ---------------------------------------------------------------------------
 * Audit
 * ------------------------------------------------------------------------- */

export async function audit(
  db: SupabaseClient,
  organizationId: string,
  actorId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await db.from('audit_log').insert({
    organization_id: organizationId,
    actor_id: actorId,
    action,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    before: before ?? null,
    after: after ?? null,
  })
}

/* ---------------------------------------------------------------------------
 * Pagination
 * ------------------------------------------------------------------------- */

export function pageParams(query: URLSearchParams) {
  const page = Math.max(1, Number(query.get('page') ?? 1) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.get('per_page') ?? 50) || 50))
  return { page, perPage, from: (page - 1) * perPage, to: page * perPage - 1 }
}
