import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { pageParams, resolvePeriod } from '../../_shared/helpers.ts'

export async function listPlayers(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const status = ctx.query.get('status')
  const search = ctx.query.get('search')?.trim()
  const withStats = ctx.query.get('with_stats') === 'true'

  let q = ctx.db
    .from('players')
    .select('*', { count: 'exact' })
    .eq('organization_id', member.organizationId)

  if (status) q = q.eq('status', status)
  else q = q.neq('status', 'inactive')

  if (search) q = q.ilike('display_name', `%${search}%`)

  const { data, error, count } = await q
    .order('display_name', { ascending: true })
    .range(from, to)

  if (error) throw new Error(error.message)

  let players = data ?? []

  if (withStats && players.length > 0) {
    const period = await resolvePeriod(ctx.db, member.organizationId, ctx.query.get('period_id'))

    // Fetch the whole period's stats in one query and join in memory — a squad
    // is tens of rows, so an IN list per page would cost more than it saves.
    const { data: allStats } = await ctx.db
      .from('player_period_stats')
      .select('*')
      .eq('period_id', period.id)

    const byPlayer = new Map((allStats ?? []).map((s: Record<string, unknown>) => [s.player_id, s]))
    players = players.map((p: Record<string, unknown>) => ({ ...p, stats: byPlayer.get(p.id) ?? null }))
  }

  return successResponse(players, 'Players', paginate(page, perPage, count ?? players.length))
}
