import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { orgSettings, resolvePeriod } from '../../_shared/helpers.ts'

export async function getOrganization(ctx: Ctx): Promise<Response> {
  const orgId = ctx.segments[0]
  const member = await requireMember(ctx.req, ctx.db, 'recorder', orgId)

  const { data: org } = await ctx.db
    .from('organizations')
    .select('*')
    .eq('id', member.organizationId)
    .maybeSingle()

  if (!org) throw notFound('Group not found')

  const settings = await orgSettings(ctx.db, org.id)
  const period = await resolvePeriod(ctx.db, org.id)

  const { data: page } = await ctx.db
    .from('public_pages')
    .select('*')
    .eq('organization_id', org.id)
    .maybeSingle()

  return successResponse({
    ...org,
    role: member.role,
    settings,
    current_period: period,
    public_page: page,
  })
}
