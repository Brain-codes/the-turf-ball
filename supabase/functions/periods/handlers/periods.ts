import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound, unprocessable } from '../../_shared/errors.ts'
import { audit, broadcast, openPeriodId, recomputeStats } from '../../_shared/helpers.ts'
import { bool, validate } from '../../_shared/validation.ts'

export async function listPeriods(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  await openPeriodId(ctx.db, member.organizationId)

  const { data, error } = await ctx.db
    .from('periods')
    .select('*')
    .eq('organization_id', member.organizationId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  if (error) throw new Error(error.message)
  return successResponse(data ?? [], 'Months')
}

/**
 * Preview a close before committing to it. The organizer should see exactly
 * who wins and why before locking a month that can only be undone by an
 * explicit, audited reopen.
 */
export async function previewClose(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const periodId = ctx.segments[0]

  const { data: period } = await ctx.db
    .from('periods')
    .select('*')
    .eq('id', periodId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!period) throw notFound('Month not found')

  const { data: stats } = await ctx.db
    .from('player_period_stats')
    .select('*, players(display_name, whatsapp_nickname, photo_url, jersey_number)')
    .eq('period_id', periodId)
    .gt('appearances', 0)
    .order('rank', { ascending: true })

  const { count: liveSessions } = await ctx.db
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('period_id', periodId)
    // A paused session is unfinished, not over — it can still be resumed, so
    // it blocks closing the month exactly like a live one.
    .in('status', ['live', 'paused'])

  return successResponse({
    period,
    standings: stats ?? [],
    winner: (stats ?? [])[0] ?? null,
    can_close: period.status === 'open' && (liveSessions ?? 0) === 0,
    blocked_reason:
      period.status !== 'open'
        ? 'This month is already closed'
        : (liveSessions ?? 0) > 0
          ? 'A session is still open — finish it first'
          : null,
  })
}

export async function closePeriod(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const periodId = ctx.segments[0]

  const { data: period } = await ctx.db
    .from('periods')
    .select('id, label')
    .eq('id', periodId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!period) throw notFound('Month not found')

  // One transactional database function does the whole close: freeze the
  // rules, recompute, award, lock, open the next month. A half-closed month
  // with awards but no lock would be unrecoverable.
  const { data, error } = await ctx.db.rpc('close_period', {
    p_period: periodId,
    p_actor: member.user.id,
  })

  if (error) throw unprocessable(error.message)

  await broadcast(ctx.db, member.organizationId, periodId, 'period.closed', { period_id: periodId })

  return successResponse(data, `${period.label} is closed. The awards are in.`)
}

export async function reopenPeriod(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const periodId = ctx.segments[0]

  const { data: period } = await ctx.db
    .from('periods')
    .select('id, label')
    .eq('id', periodId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!period) throw notFound('Month not found')

  const { error } = await ctx.db.rpc('reopen_period', {
    p_period: periodId,
    p_actor: member.user.id,
  })

  if (error) throw unprocessable(error.message)

  return successResponse(
    { period_id: periodId },
    `${period.label} is open again. The awards for that month have been cleared.`,
  )
}

/**
 * The two per-month switches: position-based points and attendance tracking.
 * Both totals are always stored, so flipping either one just recomputes the
 * month and the table follows. A closed month keeps what it was scored under.
 */
export async function updateSwitches(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const periodId = ctx.segments[0]

  const body = await ctx.body<{ positional_scoring?: boolean; attendance_tracking?: boolean }>()
  validate(body as unknown as Record<string, unknown>, {
    positional_scoring: [bool],
    attendance_tracking: [bool],
  })

  const { data: period } = await ctx.db
    .from('periods')
    .select('id, label, status')
    .eq('id', periodId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!period) throw notFound('Month not found')
  if (period.status === 'closed') {
    throw unprocessable(`${period.label} is closed. Reopen it first to change how it's scored.`)
  }

  const patch: Record<string, boolean> = {}
  if (body.positional_scoring !== undefined) patch.positional_scoring = body.positional_scoring
  if (body.attendance_tracking !== undefined) patch.attendance_tracking = body.attendance_tracking

  const { data, error } = await ctx.db
    .from('periods')
    .update(patch)
    .eq('id', periodId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  await recomputeStats(ctx.db, periodId)
  await audit(ctx.db, member.organizationId, member.user.id, 'period.switches', 'period', periodId, null, patch)
  await broadcast(ctx.db, member.organizationId, periodId, 'stats.updated', { period_id: periodId })

  return successResponse(data, `${period.label} updated and the table recalculated`)
}
