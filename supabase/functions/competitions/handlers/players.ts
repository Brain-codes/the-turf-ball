/**
 * Roster intent — who has joined the competition, before teams are drawn.
 * Both the self-serve join link and the on-the-fly quick-add (same UX as the
 * live-session quick-add) land here. Distinct from competition_team_players,
 * which is the post-draft assignment.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { required, str, validate } from '../../_shared/validation.ts'

interface AddBody {
  /** An existing squad player. */
  player_id?: string
  /** Quick-add: someone not yet in the squad, created on the spot. */
  new_player?: { first_name: string; last_name?: string; display_name: string; position?: string }
}

export async function addCompetitionPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const body = await ctx.body<AddBody>()

  let playerId = body.player_id
  if (!playerId && body.new_player) {
    validate(body.new_player as unknown as Record<string, unknown>, {
      display_name: [required, str(1, 60)],
    })
    const { data: created, error: createErr } = await ctx.db
      .from('players')
      .insert({
        organization_id: member.organizationId,
        first_name: body.new_player.first_name || body.new_player.display_name,
        last_name: body.new_player.last_name ?? null,
        display_name: body.new_player.display_name,
        position: body.new_player.position ?? null,
        status: 'active',
        created_by: member.user.id,
      })
      .select('id')
      .single()
    if (createErr) throw new Error(createErr.message)
    playerId = created.id
  }

  if (!playerId) throw badRequest('Pick a player from the squad, or add a new one')

  await assertOwned(ctx.db, 'players', playerId, member.organizationId)

  const { data, error } = await ctx.db
    .from('competition_players')
    .upsert(
      { organization_id: member.organizationId, competition_id: competitionId, player_id: playerId, removed_at: null, created_by: member.user.id },
      { onConflict: 'competition_id,player_id' },
    )
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, position, jersey_number)')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Added to the competition', {}, 201)
}

export async function removeCompetitionPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  const playerId = ctx.segments[2] // ['id', 'players', 'player_id']
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  // If teams have already been drawn, soft-remove from any active team roster
  // too — this is the admin's "not available anymore" action, never a delete.
  await ctx.db
    .from('competition_team_players')
    .update({ removed_at: new Date().toISOString() })
    .eq('competition_id', competitionId)
    .eq('player_id', playerId)
    .is('removed_at', null)

  const { data, error } = await ctx.db
    .from('competition_players')
    .update({ removed_at: new Date().toISOString() })
    .eq('competition_id', competitionId)
    .eq('player_id', playerId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound('That player is not in this competition')

  return successResponse(null, 'Removed from the competition')
}
