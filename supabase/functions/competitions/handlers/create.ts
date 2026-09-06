/** Create a competition. Wizard step 1 — draft status, no teams/fixtures yet. */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { badRequest } from '../../_shared/errors.ts'
import { int, required, str, validate } from '../../_shared/validation.ts'
import { periodForDate } from '../../_shared/helpers.ts'

interface Body {
  name: string
  starts_on: string
  ends_on: string
  day_ends_at?: string | null
  team_count: number
  squad_size: number
  pitch_size: number
  double_round_robin?: boolean
  match_duration_minutes?: number | null
  count_toward_stats?: boolean
}

export async function createCompetition(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const body = await ctx.body<Body>()

  validate(body as unknown as Record<string, unknown>, {
    name: [required, str(2, 80)],
    starts_on: [required],
    ends_on: [required],
    team_count: [required, int(2, 16)],
    squad_size: [required, int(2, 60)],
    pitch_size: [required, int(1, 60)],
    match_duration_minutes: [int(1, 180)],
  })

  if (new Date(body.ends_on) < new Date(body.starts_on)) {
    throw badRequest('The end date cannot be before the start date')
  }
  if (body.pitch_size > body.squad_size) {
    throw badRequest('Players on the pitch cannot be more than the squad size')
  }

  // Same rule as sessions: the month comes from the competition's own start date.
  const periodId = await periodForDate(ctx.db, member.organizationId, String(body.starts_on))

  const { data, error } = await ctx.db
    .from('competitions')
    .insert({
      organization_id: member.organizationId,
      period_id: periodId,
      name: body.name,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      day_ends_at: body.day_ends_at ?? null,
      team_count: body.team_count,
      squad_size: body.squad_size,
      pitch_size: body.pitch_size,
      double_round_robin: body.double_round_robin ?? false,
      match_duration_minutes: body.match_duration_minutes ?? null,
      // On by default — a competition's goals count towards a player's
      // normal record unless someone turns this off, here or later.
      count_toward_stats: body.count_toward_stats ?? true,
      created_by: member.user.id,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Competition created', {}, 201)
}
