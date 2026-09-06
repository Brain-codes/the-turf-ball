/**
 * The monthly breakdown: attendance, the full stats table, awards, records
 * broken, milestones crossed, all-time top tens, and the ready-to-paste
 * headlines.
 *
 * A closed month serves its frozen report from period_reports — the numbers
 * behind it can never move again, so neither should the report. An open month
 * has nothing frozen yet, so it is built live and clearly marked provisional.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound, unprocessable } from '../../_shared/errors.ts'

export async function periodReport(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const periodId = ctx.segments[0]

  const { data: period } = await ctx.db
    .from('periods')
    .select('id, label, status')
    .eq('id', periodId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!period) throw notFound('Month not found')

  if (period.status === 'closed') {
    const { data: stored } = await ctx.db
      .from('period_reports')
      .select('data, generated_at')
      .eq('period_id', periodId)
      .maybeSingle()

    if (stored) {
      return successResponse(
        { ...stored.data, provisional: false, generated_at: stored.generated_at },
        `${period.label} in full`,
      )
    }
    // Closed before reports existed, or reopened and re-closed by hand. Build
    // and freeze it now rather than showing the organizer an empty screen.
    const { data, error } = await ctx.db.rpc('store_period_report', { p_period: periodId })
    if (error) throw new Error(error.message)
    return successResponse({ ...data, provisional: false }, `${period.label} in full`)
  }

  const { data, error } = await ctx.db.rpc('build_period_report', { p_period: periodId })
  if (error) throw new Error(error.message)

  return successResponse({ ...data, provisional: true }, `${period.label} so far`)
}

/**
 * Rebuild a closed month's report. Only needed after a reopen-correct-reclose,
 * or when new record categories ship and an organizer wants old months to show
 * them too.
 */
export async function rebuildReport(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const periodId = ctx.segments[0]

  const { data: period } = await ctx.db
    .from('periods')
    .select('id, label')
    .eq('id', periodId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!period) throw notFound('Month not found')

  const { data, error } = await ctx.db.rpc('store_period_report', { p_period: periodId })
  if (error) throw new Error(error.message)

  return successResponse(data, `${period.label} rebuilt`)
}

/**
 * Sessions filed under the wrong month — the fallout from the old rule that
 * stamped a session with whichever month was open when it was created.
 *
 * Preview by default. Nothing moves until apply=true, because this re-files
 * real recorded play and recomputes two months' totals.
 */
export async function repairSessionMonths(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const apply = ctx.query.get('apply') === 'true'

  const { data, error } = await ctx.db.rpc('repair_session_periods', {
    p_org: member.organizationId,
    p_apply: apply,
  })

  if (error) throw unprocessable(error.message)

  const rows = (data ?? []) as { session_date: string; filed_under: string; belongs_to: string }[]

  if (rows.length === 0) {
    return successResponse({ sessions: [], applied: apply }, 'Every session is filed under the right month')
  }

  return successResponse(
    { sessions: rows, applied: apply },
    apply
      ? `Moved ${rows.length} ${rows.length === 1 ? 'session' : 'sessions'} to the month they were played in`
      : `${rows.length} ${rows.length === 1 ? 'session is' : 'sessions are'} filed under the wrong month`,
  )
}
