/**
 * Start a fixture: creates the underlying `matches` row from the two teams'
 * current rosters and links it back to the fixture. From here on, the
 * existing MatchDay event-recording engine takes over unchanged — this is
 * the one handoff point between "competition" and "match", nothing about
 * goal/assist logging is duplicated.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'

export async function startFixture(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  const fixtureId = ctx.segments[2] // ['id', 'fixtures', 'fixture_id', 'start']
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const { data: fixture } = await ctx.db
    .from('competition_fixtures')
    .select('id, match_id, home_team_id, away_team_id, duration_minutes, home_team:competition_teams!competition_fixtures_home_team_id_fkey(name), away_team:competition_teams!competition_fixtures_away_team_id_fkey(name)')
    .eq('id', fixtureId)
    .eq('competition_id', competitionId)
    .maybeSingle()

  if (!fixture) throw notFound('Fixture not found')
  if (fixture.match_id) throw badRequest('This fixture has already started')

  const [homeRoster, awayRoster] = await Promise.all([
    ctx.db.from('competition_team_players').select('player_id').eq('competition_team_id', fixture.home_team_id).is('removed_at', null),
    ctx.db.from('competition_team_players').select('player_id').eq('competition_team_id', fixture.away_team_id).is('removed_at', null),
  ])

  if (!homeRoster.data?.length || !awayRoster.data?.length) {
    throw badRequest('Both teams need at least one player before this fixture can start')
  }

  const homeName = (fixture.home_team as unknown as { name: string | null })?.name || 'Home'
  const awayName = (fixture.away_team as unknown as { name: string | null })?.name || 'Away'

  const { data: match, error: matchErr } = await ctx.db
    .from('matches')
    .insert({
      organization_id: member.organizationId,
      session_id: null,
      competition_fixture_id: fixture.id,
      sequence: 1,
      duration_minutes: fixture.duration_minutes ?? 20,
      side_a_label: homeName.slice(0, 20),
      side_b_label: awayName.slice(0, 20),
      status: 'live',
      started_at: new Date().toISOString(),
      created_by: member.user.id,
    })
    .select('*')
    .single()

  if (matchErr) throw new Error(matchErr.message)

  const rows = [
    ...homeRoster.data.map((p) => ({ organization_id: member.organizationId, match_id: match.id, player_id: p.player_id, side: 'a' as const, is_goalkeeper: false })),
    ...awayRoster.data.map((p) => ({ organization_id: member.organizationId, match_id: match.id, player_id: p.player_id, side: 'b' as const, is_goalkeeper: false })),
  ]

  const { error: rosterErr } = await ctx.db.from('match_players').insert(rows)
  if (rosterErr) {
    await ctx.db.from('matches').delete().eq('id', match.id)
    throw new Error(rosterErr.message)
  }

  await ctx.db.from('competition_fixtures').update({ match_id: match.id }).eq('id', fixture.id)
  await ctx.db.from('competitions').update({ status: 'live' }).eq('id', competitionId)

  return successResponse({ ...match, players: rows }, `${homeName} vs ${awayName} is live`, {}, 201)
}
