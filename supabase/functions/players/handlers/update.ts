import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { conflict } from '../../_shared/errors.ts'
import { int, oneOf, str, validate } from '../../_shared/validation.ts'

const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const
const FEET = ['left', 'right', 'both'] as const
const STATUSES = ['active', 'inactive', 'guest'] as const

const FIELDS = [
  'first_name', 'last_name', 'display_name', 'jersey_number',
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
    jersey_number: [int(0, 99)],
    position: [oneOf(POSITIONS)],
    preferred_foot: [oneOf(FEET)],
    status: [oneOf(STATUSES)],
  })

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

  return successResponse(data, 'Player updated')
}
