import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { isArray, required, validate } from '../../_shared/validation.ts'
import { badRequest } from '../../_shared/errors.ts'
import { audit, recomputeStats, resolvePeriod } from '../../_shared/helpers.ts'

/**
 * Scoring rules. No weight is ever hard-coded in application code — the engine
 * reads these, so one group can value a goal at 5 and another at 3 without a
 * single line of difference between them.
 */

const PRESETS = {
  balanced: {
    name: 'Balanced',
    description: 'Rewards turning up and contributing, not just scoring.',
    rules: { appearance: 1, goal: 5, assist: 3, clean_sheet: 2, own_goal: -2, yellow_card: -1, red_card: -3, punctuality: 1 },
  },
  goal_heavy: {
    name: 'Goal heavy',
    description: 'Goals decide it. For groups where finishing is everything.',
    rules: { appearance: 1, goal: 8, assist: 3, clean_sheet: 2, own_goal: -3, yellow_card: -1, red_card: -4, punctuality: 1 },
  },
  team_first: {
    name: 'Team first',
    description: 'Turning up, defending and creating count as much as scoring.',
    rules: { appearance: 3, goal: 4, assist: 4, clean_sheet: 4, own_goal: -1, yellow_card: -2, red_card: -5, punctuality: 2 },
  },
} as const

export async function getPresets(ctx: Ctx): Promise<Response> {
  await requireMember(ctx.req, ctx.db)
  return successResponse(
    Object.entries(PRESETS).map(([key, p]) => ({ key, ...p })),
    'Scoring presets',
  )
}

export async function getRules(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const requestedPeriod = ctx.query.get('period_id')

  // A closed month has its own frozen snapshot; an open one uses the defaults.
  let periodFilter: string | null = null
  if (requestedPeriod) {
    const { data: frozen } = await ctx.db
      .from('scoring_rules')
      .select('id')
      .eq('organization_id', member.organizationId)
      .eq('period_id', requestedPeriod)
      .limit(1)
    if (frozen && frozen.length > 0) periodFilter = requestedPeriod
  }

  let q = ctx.db
    .from('scoring_rules')
    .select('*')
    .eq('organization_id', member.organizationId)

  q = periodFilter ? q.eq('period_id', periodFilter) : q.is('period_id', null)

  const { data, error } = await q.order('event_type')
  if (error) throw new Error(error.message)

  return successResponse(data ?? [], 'Scoring rules', { frozen: periodFilter !== null })
}

export async function updateRules(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const body = await ctx.body<{
    rules?: { event_type: string; points: number; enabled?: boolean }[]
    preset?: keyof typeof PRESETS
  }>()

  let incoming = body.rules

  if (body.preset) {
    const preset = PRESETS[body.preset]
    if (!preset) throw badRequest('That scoring preset does not exist')
    incoming = Object.entries(preset.rules).map(([event_type, points]) => ({
      event_type,
      points,
      enabled: true,
    }))
  }

  validate({ rules: incoming } as Record<string, unknown>, { rules: [required, isArray(1, 20)] })

  for (const rule of incoming!) {
    await ctx.db
      .from('scoring_rules')
      .update({ points: rule.points, enabled: rule.enabled ?? true })
      .eq('organization_id', member.organizationId)
      .is('period_id', null)
      .eq('event_type', rule.event_type)
  }

  // The table must reflect the new rules immediately — changing a weight and
  // seeing nothing move would feel broken.
  const period = await resolvePeriod(ctx.db, member.organizationId)
  await recomputeStats(ctx.db, period.id)

  await audit(ctx.db, member.organizationId, member.user.id, 'scoring.update', 'organization', member.organizationId, null, { rules: incoming })

  const { data } = await ctx.db
    .from('scoring_rules')
    .select('*')
    .eq('organization_id', member.organizationId)
    .is('period_id', null)
    .order('event_type')

  return successResponse(data ?? [], 'Scoring updated and the table recalculated')
}
