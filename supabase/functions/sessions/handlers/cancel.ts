/**
 * "This session never happened."
 *
 * A session can be created, opened, have teams picked — and then turn out not
 * to be a real match day at all. The 30 August session that sat unplayed until
 * someone opened it a week into September is the case this was built for.
 *
 * Cancelling is not the same as ending. Ending says "we played, we're done" and
 * everything counts. Cancelling says it did not happen: the session is marked
 * cancelled, every match on it is abandoned, and the month is recomputed so
 * appearances, points and punctuality earned in it disappear.
 *
 * It works on a closed month too. This only ever removes things that should
 * never have counted, so it cannot inflate a result that is already frozen —
 * and refusing would leave an organizer with no way to undo a mistake made in
 * the last month.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { audit, recomputeStats } from '../../_shared/helpers.ts'

export async function cancelSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  const { data: session, error: loadError } = await ctx.db
    .from('sessions')
    .select('id, title, session_date, status, period_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (loadError) throw new Error(`Could not load the session: ${loadError.message}`)
  if (!session) throw notFound('Session not found')
  if (session.status === 'cancelled') throw badRequest('That session is already cancelled')

  // Count what is about to stop counting, so the organizer is told plainly
  // rather than watching numbers move on their own.
  const { data: matches } = await ctx.db
    .from('matches')
    .select('id')
    .eq('session_id', sessionId)

  const matchIds = (matches ?? []).map((m) => m.id)

  let recorded = 0
  if (matchIds.length > 0) {
    const { count } = await ctx.db
      .from('match_events')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds)
      .is('voided_at', null)
    recorded = count ?? 0

    const { error: matchError } = await ctx.db
      .from('matches')
      .update({ status: 'abandoned' })
      .in('id', matchIds)
    if (matchError) throw new Error(`Could not abandon the matches: ${matchError.message}`)
  }

  const { data: updated, error } = await ctx.db
    .from('sessions')
    .update({
      status: 'cancelled',
      awaiting_confirmation: false,
      paused_at: null,
      paused_reason: null,
    })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  // The month has to be rebuilt, or the appearances this session handed out
  // stay on the leaderboard.
  await recomputeStats(ctx.db, session.period_id)

  await audit(ctx.db, member.organizationId, member.user.id, 'session.cancel', 'session', sessionId)

  const when = session.session_date
  return successResponse(
    { session: updated, events_discarded: recorded },
    recorded > 0
      ? `${when} is cancelled. ${recorded} recorded ${recorded === 1 ? 'moment' : 'moments'} no longer count.`
      : `${when} is cancelled. It counts for nothing.`,
  )
}
