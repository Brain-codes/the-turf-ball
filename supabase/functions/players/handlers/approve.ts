/**
 * Approve or reject a self-submitted player (status 'pending').
 *
 * A prospective player submits themselves through the unauthenticated
 * invite link (public/handlers/publicJoin.ts), which creates a `players`
 * row with status = 'pending'. An admin reviews the queue (onboarding step
 * 3, later Settings) and decides.
 *
 * Judgment call on reject: DELETE the row rather than setting 'inactive'.
 * A rejected submission was never a real roster member — it has no
 * attendance, no events, nothing else references it yet (self-serve players
 * can only be pending before this point), so there is no history to
 * preserve and no reason to leave clutter behind. 'inactive' is reserved for
 * a player who WAS active and stopped playing, which is a different
 * situation. Documented in HANDOFF.md.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { audit } from '../../_shared/helpers.ts'

export async function approvePlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const playerId = ctx.segments[0]

  const { data, error } = await ctx.db
    .from('players')
    .update({ status: 'active' })
    .eq('id', playerId)
    .eq('organization_id', member.organizationId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound('That pending player was not found')

  await audit(ctx.db, member.organizationId, member.user.id, 'player.approve', 'player', playerId)

  return successResponse(data, `${data.display_name} approved`)
}

export async function rejectPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const playerId = ctx.segments[0]

  const { data, error } = await ctx.db
    .from('players')
    .delete()
    .eq('id', playerId)
    .eq('organization_id', member.organizationId)
    .eq('status', 'pending')
    .select('id, display_name')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound('That pending player was not found')

  await audit(ctx.db, member.organizationId, member.user.id, 'player.reject', 'player', playerId)

  return successResponse({ id: playerId }, `${data.display_name} rejected`)
}
