/**
 * How strong is each drawn team, relative to the others? Computed on read
 * from the same signal the draft itself balances on (total_points per
 * appearance this period — the org's own composite of goals, assists,
 * clean sheets, cards and punctuality, weighted by its own scoring rules)
 * so the number on screen always matches what the draw was actually
 * optimizing for — nothing here is a second, independent metric.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'

export async function getTeamBalance(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const { data: competition } = await ctx.db
    .from('competitions')
    .select('period_id')
    .eq('id', competitionId)
    .maybeSingle()

  const { data: teams } = await ctx.db
    .from('competition_teams')
    .select('id, competition_team_players(player_id, removed_at)')
    .eq('competition_id', competitionId)

  const activeTeams = (teams ?? []).map((t) => ({
    id: t.id,
    playerIds: (t.competition_team_players ?? [])
      .filter((tp: { removed_at: string | null }) => !tp.removed_at)
      .map((tp: { player_id: string }) => tp.player_id),
  }))

  const allPlayerIds = activeTeams.flatMap((t) => t.playerIds)

  // Smoothed: a player with one big game isn't treated as a certain,
  // proven rate — that's one good night, not a track record. Shrinking
  // towards 0 by a few "phantom" appearances stops one outlier performance
  // from single-handedly swinging a team's whole rating (see the 100 vs 20
  // report this replaced: one player's single recorded goal was making
  // their whole team look 5x stronger than the rest, off one appearance).
  const SMOOTHING_APPEARANCES = 3
  let scorersWithHistory = 0
  const qualityOf = new Map<string, number>()
  if (competition?.period_id && allPlayerIds.length > 0) {
    const { data: stats } = await ctx.db
      .from('player_period_stats')
      .select('player_id, total_points, appearances')
      .eq('period_id', competition.period_id)
      .in('player_id', allPlayerIds)
    for (const s of stats ?? []) {
      if (s.appearances > 0) scorersWithHistory++
      qualityOf.set(s.player_id, s.total_points / (s.appearances + SMOOTHING_APPEARANCES))
    }
  }

  const perTeam = activeTeams.map((t) => {
    const total = t.playerIds.reduce((sum, id) => sum + (qualityOf.get(id) ?? 0), 0)
    return {
      team_id: t.id,
      player_count: t.playerIds.length,
      average_quality: t.playerIds.length ? Number((total / t.playerIds.length).toFixed(3)) : 0,
    }
  })

  // With fewer players carrying any match history than there are teams, a
  // comparison can't mean anything — one team drew the one person who's
  // scored and the rest look "weak" purely because nobody's played enough
  // games yet, not because the draft favored anyone. Rather than print a
  // misleadingly precise number off that little data, say so plainly and
  // let the position-balanced draw stand on its own until there's enough
  // history to actually compare.
  const hasEnoughData = scorersWithHistory >= activeTeams.length
  if (!hasEnoughData) {
    return successResponse(
      perTeam.map((t) => ({ ...t, strength_rating: null })),
      'Not enough match history yet to rate team strength — teams are still balanced evenly by position.',
    )
  }

  // Rated around the pool's own average (100 = exactly average for
  // tonight's draw). This is a DEVIATION from the mean, not a ratio to it —
  // total_points can go negative (cards, own goals outweighing
  // contributions), and a ratio flips sign incorrectly once the mean itself
  // is negative: a team truly better than average could come out rated
  // *lower*. Measuring "how far above or below average, scaled so the most
  // extreme team in this draw lands at 130 or 70" gives the right order
  // regardless of sign, and a single outlier still can't blow the number
  // past that band.
  const meanQuality = perTeam.reduce((sum, t) => sum + t.average_quality, 0) / perTeam.length
  const maxDeviation = Math.max(0, ...perTeam.map((t) => Math.abs(t.average_quality - meanQuality)))
  const rated = perTeam.map((t) => ({
    ...t,
    strength_rating: maxDeviation > 0
      ? Math.round(100 + ((t.average_quality - meanQuality) / maxDeviation) * 30)
      : 100,
  }))

  return successResponse(rated)
}
