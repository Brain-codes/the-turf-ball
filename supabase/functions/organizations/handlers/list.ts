import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'

export async function listOrganizations(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)

  const { data, error } = await ctx.db
    .from('organization_members')
    .select('role, organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (error) throw new Error(error.message)

  const orgs = (data ?? []).map((m: Record<string, unknown>) => ({
    ...(m.organizations as Record<string, unknown>),
    role: m.role,
  }))

  return successResponse(orgs, 'Your groups', { total: orgs.length })
}
