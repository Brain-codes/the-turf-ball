/**
 * Standings — computed on read, not materialized. Competition-scale data is
 * small (a 16-team double round-robin is 240 fixtures at most), so a live
 * aggregate is trivial and there's nothing extra to keep in sync.
 *
 * Tiebreak, exactly as decided: points -> goal difference -> goals scored ->
 * genuinely level. No head-to-head — that's a group/knockout concept this
 * league format doesn't use.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'

interface Row {
  team_id: string
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  points: number
}

export async function getStandings(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const { data: teams } = await ctx.db
    .from('competition_teams')
    .select('id, name, short_name, color')
    .eq('competition_id', competitionId)

  const { data: fixtures } = await ctx.db
    .from('competition_fixtures')
    .select('home_team_id, away_team_id, matches!competition_fixtures_match_id_fkey(status, side_a_score, side_b_score)')
    .eq('competition_id', competitionId)

  const rows = new Map<string, Row>()
  for (const t of teams ?? []) {
    rows.set(t.id, { team_id: t.id, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0 })
  }

  for (const f of fixtures ?? []) {
    const match = f.matches as unknown as { status: string; side_a_score: number; side_b_score: number } | null
    if (!match || match.status !== 'completed') continue

    const home = rows.get(f.home_team_id)
    const away = rows.get(f.away_team_id)
    if (!home || !away) continue

    home.played++; away.played++
    home.goals_for += match.side_a_score; home.goals_against += match.side_b_score
    away.goals_for += match.side_b_score; away.goals_against += match.side_a_score

    if (match.side_a_score > match.side_b_score) {
      home.won++; home.points += 3
      away.lost++
    } else if (match.side_a_score < match.side_b_score) {
      away.won++; away.points += 3
      home.lost++
    } else {
      home.drawn++; away.drawn++
      home.points += 1; away.points += 1
    }
  }

  const teamById = new Map((teams ?? []).map((t) => [t.id, t]))
  const standings = [...rows.values()]
    .map((r) => ({
      ...r,
      team: teamById.get(r.team_id),
      goal_difference: r.goals_for - r.goals_against,
    }))
    .sort((a, b) =>
      b.points - a.points ||
      b.goal_difference - a.goal_difference ||
      b.goals_for - a.goals_for ||
      (a.team?.name ?? '').localeCompare(b.team?.name ?? ''),
    )

  return successResponse(standings)
}
