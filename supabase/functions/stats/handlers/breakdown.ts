/**
 * Session-vs-competition breakdown for one player's stats. Powers the "?"
 * detail toggle shown next to goals/assists wherever a player's numbers
 * appear — the headline number stays the combined total, this is the
 * opt-in detail behind it.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { resolvePeriod } from '../../_shared/helpers.ts'

export async function statsBreakdown(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const playerId = ctx.segments[0] // ['player_id', 'breakdown']
  const period = await resolvePeriod(ctx.db, member.organizationId, ctx.query.get('period_id'))

  const { data, error } = await ctx.db.rpc('player_stats_breakdown', { p_player: playerId, p_period: period.id })
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as ({ source: 'session' | 'competition' } & Record<string, number>)[]
  const session = rows.find((r) => r.source === 'session') ?? null
  const competition = rows.find((r) => r.source === 'competition') ?? null

  return successResponse({ period, session, competition })
}
