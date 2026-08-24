import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { str, uuid, validate } from '../../_shared/validation.ts'

/** Rename, recolor, or set a captain. Captain is cosmetic — a badge, no permissions. */
export async function updateTeam(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  const teamId = ctx.segments[2] // ['id', 'teams', 'team_id']
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)
  await assertOwned(ctx.db, 'competition_teams', teamId, member.organizationId)

  const body = await ctx.body<{ name?: string; short_name?: string; color?: string; captain_player_id?: string | null }>()
  validate(body as unknown as Record<string, unknown>, {
    name: [str(1, 40)],
    short_name: [str(1, 10)],
    color: [str(0, 20)],
    captain_player_id: [uuid],
  })

  if (body.captain_player_id) {
    const { data: onTeam } = await ctx.db
      .from('competition_team_players')
      .select('id')
      .eq('competition_team_id', teamId)
      .eq('player_id', body.captain_player_id)
      .is('removed_at', null)
      .maybeSingle()
    if (!onTeam) throw badRequest('The captain must be a player on this team')
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.short_name !== undefined) patch.short_name = body.short_name
  if (body.color !== undefined) patch.color = body.color
  if (body.captain_player_id !== undefined) patch.captain_player_id = body.captain_player_id

  const { data, error } = await ctx.db
    .from('competition_teams')
    .update(patch)
    .eq('id', teamId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Team updated')
}

/** Manually add a player to a team — only someone already registered to this competition. */
export async function addTeamPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  const teamId = ctx.segments[2]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)
  await assertOwned(ctx.db, 'competition_teams', teamId, member.organizationId)

  const body = await ctx.body<{ player_id: string }>()
  validate(body as unknown as Record<string, unknown>, { player_id: [uuid] })
  if (!body.player_id) throw badRequest('Choose a player')

  const { data: registered } = await ctx.db
    .from('competition_players')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('player_id', body.player_id)
    .is('removed_at', null)
    .maybeSingle()

  if (!registered) throw badRequest('That player has not joined this competition — add them to the competition first')

  // Moving between teams: soft-remove any other active assignment first, the
  // partial unique index only forbids two ACTIVE rows for the same player.
  await ctx.db
    .from('competition_team_players')
    .update({ removed_at: new Date().toISOString() })
    .eq('competition_id', competitionId)
    .eq('player_id', body.player_id)
    .is('removed_at', null)

  const { data, error } = await ctx.db
    .from('competition_team_players')
    .insert({
      organization_id: member.organizationId,
      competition_id: competitionId,
      competition_team_id: teamId,
      player_id: body.player_id,
      created_by: member.user.id,
    })
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, position, jersey_number)')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Player added to team', {}, 201)
}

export async function removeTeamPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  const teamId = ctx.segments[2]
  const playerId = ctx.segments[4] // ['id', 'teams', 'team_id', 'players', 'player_id']
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)
  await assertOwned(ctx.db, 'competition_teams', teamId, member.organizationId)

  const { data, error } = await ctx.db
    .from('competition_team_players')
    .update({ removed_at: new Date().toISOString() })
    .eq('competition_team_id', teamId)
    .eq('player_id', playerId)
    .is('removed_at', null)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound('That player is not on this team')

  return successResponse(null, 'Removed from team')
}
