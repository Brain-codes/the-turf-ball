import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { conflict } from '../../_shared/errors.ts'
import { int, oneOf, required, str, validate } from '../../_shared/validation.ts'

const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const
const FEET = ['left', 'right', 'both'] as const
const STATUSES = ['active', 'inactive', 'guest'] as const

export async function createPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    first_name: [required, str(1, 40)],
    last_name: [str(0, 40)],
    display_name: [str(1, 40)],
    jersey_number: [int(0, 99)],
    position: [oneOf(POSITIONS)],
    preferred_foot: [oneOf(FEET)],
    status: [oneOf(STATUSES)],
  })

  const firstName = String(body.first_name).trim()

  const { data, error } = await ctx.db
    .from('players')
    .insert({
      organization_id: member.organizationId,
      first_name: firstName,
      last_name: body.last_name ? String(body.last_name).trim() : null,
      display_name: body.display_name ? String(body.display_name).trim() : firstName,
      jersey_number: body.jersey_number ?? null,
      position: body.position ?? null,
      preferred_foot: body.preferred_foot ?? null,
      photo_url: body.photo_url ?? null,
      status: body.status ?? 'active',
      created_by: member.user.id,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') throw conflict('Another player already has that shirt number')
    throw new Error(error.message)
  }

  return successResponse(data, `${data.display_name} added`, {}, 201)
}
