import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest } from '../../_shared/errors.ts'
import { bool, int, str, validate } from '../../_shared/validation.ts'
import { recomputeStats } from '../../_shared/helpers.ts'

interface Body {
  name?: string
  starts_on?: string
  ends_on?: string
  day_ends_at?: string | null
  match_duration_minutes?: number | null
  count_toward_stats?: boolean
}

/**
 * Almost everything about a competition stays editable — end date, timing,
 * the stats toggle — reflecting that a real Thursday-night tournament keeps
 * changing shape right up until (and during) the day.
 */
export async function updateCompetition(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const id = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', id, member.organizationId)

  const body = await ctx.body<Body>()
  validate(body as unknown as Record<string, unknown>, {
    name: [str(2, 80)],
    match_duration_minutes: [int(1, 180)],
  })

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.starts_on !== undefined) patch.starts_on = body.starts_on
  if (body.ends_on !== undefined) patch.ends_on = body.ends_on
  if (body.day_ends_at !== undefined) patch.day_ends_at = body.day_ends_at
  if (body.match_duration_minutes !== undefined) patch.match_duration_minutes = body.match_duration_minutes
  if (body.count_toward_stats !== undefined) patch.count_toward_stats = body.count_toward_stats

  if (patch.starts_on && patch.ends_on && new Date(patch.ends_on as string) < new Date(patch.starts_on as string)) {
    throw badRequest('The end date cannot be before the start date')
  }

  const { data, error } = await ctx.db
    .from('competitions')
    .update(patch)
    .eq('id', id)
    .select('*, period_id')
    .single()

  if (error) throw new Error(error.message)

  // Flipping the stats toggle changes what counts towards every player's
  // record — nothing is deleted or rewritten, the aggregate just moves.
  if (body.count_toward_stats !== undefined) {
    await recomputeStats(ctx.db, data.period_id)
  }

  return successResponse(data, 'Competition updated')
}

/** Cancel = soft-void. Never hard-deleted, same pattern as match_events. */
export async function cancelCompetition(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const id = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', id, member.organizationId)

  const { data, error } = await ctx.db
    .from('competitions')
    .update({ status: 'cancelled', voided_at: new Date().toISOString(), voided_by: member.user.id })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Competition cancelled')
}

/**
 * Settings-surface toggle — the same field as PATCH /competitions/:id, but a
 * dedicated route because this is the one thing still editable on a
 * completed/archived competition, months later.
 */
export async function setStatsToggle(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const id = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', id, member.organizationId)

  const body = await ctx.body<{ count_toward_stats: boolean }>()
  validate(body as unknown as Record<string, unknown>, { count_toward_stats: [bool] })
  if (body.count_toward_stats === undefined) {
    throw badRequest('Say whether this competition should count towards stats')
  }

  const { data, error } = await ctx.db
    .from('competitions')
    .update({ count_toward_stats: body.count_toward_stats })
    .eq('id', id)
    .select('*, period_id')
    .single()

  if (error) throw new Error(error.message)
  await recomputeStats(ctx.db, data.period_id)

  return successResponse(
    data,
    body.count_toward_stats
      ? 'This competition now counts towards player stats'
      : 'This competition no longer counts towards player stats',
  )
}
