/** Starting and finishing a match, including the clean-sheet decision. */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import {
  broadcast,
  orgSettings,
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
 * Clean sheets awarded at the earlier finish were only ever provisional
 * against that moment's score — cleared here and re-decided at the next
 * real finish, same as finishMatch already does when called twice. A clean
 * sheet somebody recorded by hand is not provisional and survives.
 */
export async function resumeMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]
  await assertOwned(ctx.db, 'matches', matchId, member.organizationId)

  await ctx.db
    .from('match_events')
    .delete()
    .eq('match_id', matchId)
    .eq('event_type', 'clean_sheet')
    .filter('metadata->>manual', 'is', null)

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
 * Finish a match and settle clean sheets.
 *
 * Who gets a clean sheet is a genuine disagreement between football groups, so
 * it is a setting rather than a hard-coded rule:
 *   goalkeeper  — only the keeper of a side that conceded nothing
 *   whole_side  — every player on that side
 *   manual      — exactly who the organizer names
 */
export async function finishMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]
  await assertOwned(ctx.db, 'matches', matchId, member.organizationId)

  const body = await ctx.body<{ clean_sheets?: string[] }>()

  const { data: match } = await ctx.db
    .from('matches')
    .select('*, sessions(id, period_id)')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) throw notFound('Match not found')

  const session = match.sessions as { id: string; period_id: string }

  await refreshMatchScore(ctx.db, matchId)

  const { data: fresh } = await ctx.db
    .from('matches')
    .select('side_a_score, side_b_score')
    .eq('id', matchId)
    .single()

  const settings = await orgSettings(ctx.db, member.organizationId)

  if (settings.track_clean_sheets) {
    const { data: roster } = await ctx.db
      .from('match_players')
      .select('player_id, side, is_goalkeeper')
      .eq('match_id', matchId)

    // Anyone can go in goal in 5-a-side, so a clean sheet tapped in during the
    // match is the only reliable signal there is. Those rows are left exactly
    // as they are and excluded from the automatic decision below.
    const { data: manual } = await ctx.db
      .from('match_events')
      .select('player_id')
      .eq('match_id', matchId)
      .eq('event_type', 'clean_sheet')
      .is('voided_at', null)
      .filter('metadata->>manual', 'eq', 'true')

    const manualPlayerIds = new Set((manual ?? []).map((m) => m.player_id as string))

    let awarded: { player_id: string; side: 'a' | 'b' }[] = []

    if (settings.clean_sheet_policy === 'manual') {
      const named = new Set(body.clean_sheets ?? [])
      awarded = (roster ?? [])
        .filter((r) => named.has(r.player_id))
        .map((r) => ({ player_id: r.player_id, side: r.side }))
    } else {
      // A side kept a clean sheet if the opposition scored nothing.
      const sidesWithCleanSheet: ('a' | 'b')[] = []
      if ((fresh?.side_b_score ?? 0) === 0) sidesWithCleanSheet.push('a')
      if ((fresh?.side_a_score ?? 0) === 0) sidesWithCleanSheet.push('b')

      awarded = (roster ?? [])
        .filter((r) => sidesWithCleanSheet.includes(r.side))
        .filter((r) => settings.clean_sheet_policy === 'whole_side' || r.is_goalkeeper)
        .map((r) => ({ player_id: r.player_id, side: r.side }))
    }

    // Replace rather than append, so finishing a match twice cannot double up.
    // Only the automatic awards are replaced — a manual one is a decision, not
    // a derivation, and re-finishing must not silently undo it.
    await ctx.db
      .from('match_events')
      .delete()
      .eq('match_id', matchId)
      .eq('event_type', 'clean_sheet')
      .filter('metadata->>manual', 'is', null)

    awarded = awarded.filter((a) => !manualPlayerIds.has(a.player_id))

    if (awarded.length > 0) {
      await ctx.db.from('match_events').insert(
        awarded.map((a) => ({
          organization_id: member.organizationId,
          match_id: matchId,
          session_id: session.id,
          period_id: session.period_id,
          player_id: a.player_id,
          event_type: 'clean_sheet',
          side: a.side,
          created_by: member.user.id,
        })),
      )
    }
  }

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
