/** Starting and finishing a match, including the clean-sheet decision. */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import {
  broadcast,
  recomputeStats,
  refreshMatchScore,
} from '../../_shared/helpers.ts'

export async function startMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]
  await assertOwned(ctx.db, 'matches', matchId, member.organizationId)

  const { data, error } = await ctx.db
    .from('matches')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', matchId)
    .select('*, sessions(id)')
    .single()

  if (error) throw new Error(error.message)

  // Starting a match implies the session is under way.
  await ctx.db
    .from('sessions')
    .update({ status: 'live' })
    .eq('id', (data.sessions as { id: string }).id)
    .eq('status', 'scheduled')

  return successResponse(data, 'Kick off')
}

/**
 * Resume a match that already went to full time, instead of starting a
 * brand-new one for the rest of the session. A session is one continuous
 * activity — restarting used to create a second `matches` row with its own
 * roster and event list, which reset the on-screen clock and goal totals to
 * zero even though the players never left the pitch. Reusing the same match
 * keeps the clock, events and roster exactly where they were.
 *
 * Clean sheets are untouched. They are no longer derived from the scoreline
 * at any moment — every one of them is a deliberate tap by whoever was
 * watching the goal, so there is nothing here that can be re-decided.
 */
export async function resumeMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]
  await assertOwned(ctx.db, 'matches', matchId, member.organizationId)

  const { data, error } = await ctx.db
    .from('matches')
    .update({ status: 'live', ended_at: null })
    .eq('id', matchId)
    .select('*, sessions(id, period_id)')
    .single()

  if (error) throw new Error(error.message)

  const session = data.sessions as { id: string; period_id: string }
  await recomputeStats(ctx.db, session.period_id)

  return successResponse(data, 'Match resumed')
}

/**
 * Finish a match.
 *
 * Clean sheets are deliberately NOT decided here any more. A session is played
 * as a run of short sets with sides re-forming and the keeper rotating between
 * them, but the whole session is a single `matches` row with everyone on one
 * squad — so there is no scoreline this code could read that would mean "the
 * keeper conceded nothing in that set". The only thing that knows is the
 * person on the touchline, who taps it in per set as it happens.
 *
 * The old rule read `is_goalkeeper` off the roster, which no screen has ever
 * set, so it credited nobody under the default policy and credited literally
 * everyone under `whole_side`. Both were wrong against hand-recorded counts.
 */
export async function finishMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]
  await assertOwned(ctx.db, 'matches', matchId, member.organizationId)

  const { data: match } = await ctx.db
    .from('matches')
    .select('*, sessions(id, period_id)')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) throw notFound('Match not found')

  const session = match.sessions as { id: string; period_id: string }

  await refreshMatchScore(ctx.db, matchId)

  const { data: updated, error } = await ctx.db
    .from('matches')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', matchId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  await recomputeStats(ctx.db, session.period_id)
  await broadcast(ctx.db, member.organizationId, session.period_id, 'match.finished', {
    match_id: matchId,
  })

  // One squad, not two teams — lead with goals scored; only mention own
  // goals (side_b_score) if there were any.
  const finishMessage = updated.side_b_score > 0
    ? `Full time: ${updated.side_a_score} scored, ${updated.side_b_score} own goal${updated.side_b_score === 1 ? '' : 's'}`
    : `Full time: ${updated.side_a_score} scored`

  return successResponse(updated, finishMessage)
}

/** Change the sides mid-session — people arrive late and teams get rebalanced. */
export async function updateRoster(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]
  await assertOwned(ctx.db, 'matches', matchId, member.organizationId)

  const body = await ctx.body<{
    side_a: string[]
    side_b: string[]
    goalkeeper_a?: string
    goalkeeper_b?: string
  }>()

  const rows = [
    ...(body.side_a ?? []).map((id) => ({
      organization_id: member.organizationId,
      match_id: matchId,
      player_id: id,
      side: 'a' as const,
      is_goalkeeper: id === body.goalkeeper_a,
    })),
    ...(body.side_b ?? []).map((id) => ({
      organization_id: member.organizationId,
      match_id: matchId,
      player_id: id,
      side: 'b' as const,
      is_goalkeeper: id === body.goalkeeper_b,
    })),
  ]

  await ctx.db.from('match_players').delete().eq('match_id', matchId)
  if (rows.length > 0) {
    const { error } = await ctx.db.from('match_players').insert(rows)
    if (error) throw new Error(error.message)
  }

  return successResponse(rows, 'Teams updated')
}
