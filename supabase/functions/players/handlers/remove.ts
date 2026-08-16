import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { audit } from '../../_shared/helpers.ts'

/**
 * Soft delete. A player who has appeared in matches is part of the record —
 * hard-deleting them would silently rewrite past scorelines and league tables.
 * Setting them inactive removes them from selection lists and frees their
 * shirt number, while every goal they scored stays intact.
 */
export async function removePlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const playerId = ctx.segments[0]
  await assertOwned(ctx.db, 'players', playerId, member.organizationId)

  const { data, error } = await ctx.db
    .from('players')
    .update({ status: 'inactive' })
    .eq('id', playerId)
    .eq('organization_id', member.organizationId)
    .select('id, display_name')
    .single()

  if (error) throw new Error(error.message)

  await audit(ctx.db, member.organizationId, member.user.id, 'player.deactivate', 'player', playerId)
  return successResponse(data, `${data.display_name} removed from the squad`)
}
