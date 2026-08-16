import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { pageParams } from '../../_shared/helpers.ts'

export async function listSessions(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const { page, perPage, from, to } = pageParams(ctx.query)

  let q = ctx.db
    .from('sessions')
    .select('*, matches(id, sequence, status, side_a_score, side_b_score)', { count: 'exact' })
    .eq('organization_id', member.organizationId)

  const periodId = ctx.query.get('period_id')
  if (periodId) q = q.eq('period_id', periodId)

  const status = ctx.query.get('status')
  if (status) q = q.eq('status', status)

  const { data, error, count } = await q
    .order('session_date', { ascending: false })
    .range(from, to)

  if (error) throw new Error(error.message)
  return successResponse(data ?? [], 'Sessions', paginate(page, perPage, count ?? 0))
}
