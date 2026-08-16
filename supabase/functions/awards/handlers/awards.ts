import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { resolvePeriod } from '../../_shared/helpers.ts'

export async function listAwards(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const period = await resolvePeriod(ctx.db, member.organizationId, ctx.query.get('period_id'))

  const { data, error } = await ctx.db
    .from('awards')
    .select('*, award_types(code, name, icon, description), players(id, display_name, photo_url, jersey_number)')
    .eq('period_id', period.id)

  if (error) throw new Error(error.message)

  // An open month has no awards yet, so show who is currently leading instead
  // of an empty screen.
  let provisional = null
  if (period.status === 'open') {
    const { data: leader } = await ctx.db
      .from('player_period_stats')
      .select('*, players(id, display_name, photo_url, jersey_number)')
      .eq('period_id', period.id)
      .gt('appearances', 0)
      .order('rank', { ascending: true })
      .limit(1)
      .maybeSingle()
    provisional = leader ?? null
  }

  return successResponse(
    { period, awards: data ?? [], provisional_leader: provisional },
    period.status === 'open' ? 'Still to play for' : 'Awards',
  )
}

export async function awardHistory(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)

  const { data, error } = await ctx.db
    .from('awards')
    .select('*, award_types(code, name, icon), players(id, display_name, photo_url), periods(label, year, month)')
    .eq('organization_id', member.organizationId)
    .order('awarded_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)
  return successResponse(data ?? [], 'Award history')
}
