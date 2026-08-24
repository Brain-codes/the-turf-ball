import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { bool, num, oneOf, validate } from '../../_shared/validation.ts'
import { orgSettings } from '../../_shared/helpers.ts'

const POLICIES = ['goalkeeper', 'whole_side', 'manual'] as const

const FIELDS = [
  'clean_sheet_policy', 'track_punctuality', 'track_cards', 'track_clean_sheets',
  'guests_on_leaderboard', 'early_before_mins', 'on_time_after_mins', 'late_after_mins',
  'early_points', 'on_time_points', 'late_points', 'very_late_points', 'voting_enabled',
  'auto_close_months', 'auto_close_grace_days',
] as const

export async function getSettings(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'recorder', ctx.segments[0])
  return successResponse(await orgSettings(ctx.db, member.organizationId))
}

export async function updateSettings(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin', ctx.segments[0])
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    clean_sheet_policy: [oneOf(POLICIES)],
    track_punctuality: [bool],
    track_cards: [bool],
    track_clean_sheets: [bool],
    guests_on_leaderboard: [bool],
    early_before_mins: [num(0, 240)],
    on_time_after_mins: [num(0, 240)],
    late_after_mins: [num(0, 240)],
    auto_close_months: [bool],
    auto_close_grace_days: [num(0, 14)],
  })

  await orgSettings(ctx.db, member.organizationId) // ensure the row exists

  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f]

  const { data, error } = await ctx.db
    .from('org_settings')
    .update(patch)
    .eq('organization_id', member.organizationId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Settings saved')
}
