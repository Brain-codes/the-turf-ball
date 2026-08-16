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

/** Recording into a closed month is refused — that is the whole point of closing. */
export async function assertPeriodOpen(db: SupabaseClient, periodId: string): Promise<void> {
  const { data, error } = await db
    .from('periods')
    .select('status, label')
    .eq('id', periodId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Month not found')
  if (data.status !== 'open') {
    throw unprocessable(`${data.label} has been closed. Reopen it first if you need to change it.`)
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
