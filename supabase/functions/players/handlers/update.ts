import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, conflict } from '../../_shared/errors.ts'
import { int, oneOf, str, validate } from '../../_shared/validation.ts'
import { openPeriodId, recomputeStats } from '../../_shared/helpers.ts'

const POSITIONS = [
  'GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF',
] as const
const FEET = ['left', 'right', 'both'] as const
const STATUSES = ['active', 'inactive', 'guest'] as const

const FIELDS = [
  'first_name', 'last_name', 'display_name', 'whatsapp_nickname', 'jersey_number',
  'position', 'preferred_foot', 'photo_url', 'status',
] as const

export async function updatePlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const playerId = ctx.segments[0]
  await assertOwned(ctx.db, 'players', playerId, member.organizationId)

  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    first_name: [str(1, 40)],
    last_name: [str(0, 40)],
    display_name: [str(1, 40)],
    whatsapp_nickname: [str(0, 40)],
    jersey_number: [int(0, 99)],
    position: [oneOf(POSITIONS)],
    preferred_foot: [oneOf(FEET)],
    status: [oneOf(STATUSES)],
  })

  // A position can be changed but never cleared — it sets a player's points.
  if ('position' in body && (body.position === null || body.position === '')) {
    throw badRequest('Pick a position for this player')
  }

  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f]

  const { data, error } = await ctx.db
    .from('players')
    .update(patch)
    .eq('id', playerId)
    .eq('organization_id', member.organizationId)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') throw conflict('Another player already has that shirt number')
    throw new Error(error.message)
  }

  // A new position changes what their goals and assists are worth this month.
  // Closed months keep the position they were scored with.
  if (patch.position !== undefined) {
    await recomputeStats(ctx.db, await openPeriodId(ctx.db, member.organizationId))
  }

  return successResponse(data, 'Player updated')
}
