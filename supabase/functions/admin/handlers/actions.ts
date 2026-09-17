/**
 * GET /admin/actions — the super admin change log, newest first.
 */

import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { requireSuperAdmin } from '../../_shared/auth.ts'
import { pageParams } from '../../_shared/helpers.ts'

export async function listActions(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const { data, error, count } = await ctx.db
    .from('admin_actions')
    .select('id, action, target_type, target_id, details, created_at, admin:profiles(email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw new Error(error.message)
  return successResponse(data ?? [], 'Request successful', paginate(page, perPage, count ?? 0))
}
