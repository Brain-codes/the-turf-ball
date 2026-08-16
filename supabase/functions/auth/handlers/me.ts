import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'

/** Who am I, and which groups am I in? The app calls this on every boot. */
export async function me(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)

  const { data: profile } = await ctx.db
    .from('profiles')
    .select('id, email, full_name, avatar_url, onboarded_at')
    .eq('id', user.id)
    .maybeSingle()

  const { data: memberships } = await ctx.db
    .from('organization_members')
    .select('role, organizations(id, name, short_name, slug, logo_url)')
    .eq('user_id', user.id)
    .eq('status', 'active')

  const organizations = (memberships ?? []).map((m: Record<string, unknown>) => ({
    ...(m.organizations as Record<string, unknown>),
    role: m.role,
  }))

  return successResponse({
    profile: profile ?? { id: user.id, email: user.email },
    organizations,
    needs_onboarding: organizations.length === 0,
  })
}
