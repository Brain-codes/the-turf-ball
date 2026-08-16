import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'
import { forbidden } from '../../_shared/errors.ts'

/**
 * Who am I, and which groups am I in? The app calls this on every boot — which
 * makes it the natural place to resolve account deletion, since a Supabase
 * session can still be valid for a soft-deleted profile.
 *
 * - deleted_at set, within 30 days: reactivate. Clear deleted_at on the
 *   profile and on any organizations that were deleted at that same moment
 *   (i.e. deleted as part of the same account deletion), then continue.
 * - deleted_at set, past 30 days: DECIDED — treat as if the account does not
 *   exist. The purge job (see migration 20260816150000) should have already
 *   hard-deleted it, but if it hasn't run yet this closes the gap: block
 *   login here with 403 rather than letting a zombie session through. The
 *   frontend signs the user out on this response (see AuthProvider).
 */
export async function me(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)

  const { data: profile } = await ctx.db
    .from('profiles')
    .select('id, email, full_name, avatar_url, onboarded_at, deleted_at')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.deleted_at) {
    const deletedAt = new Date(profile.deleted_at)
    const graceExpired = Date.now() - deletedAt.getTime() > 30 * 24 * 60 * 60 * 1000

    if (graceExpired) {
      throw forbidden('This account has been deleted')
    }

    // Reactivate: clear the profile, and any organizations deleted in the
    // same batch (owner_id = this user, deleted_at = the exact same
    // timestamp — anything deleted independently later stays deleted).
    await ctx.db.from('profiles').update({ deleted_at: null }).eq('id', user.id)
    await ctx.db
      .from('organizations')
      .update({ deleted_at: null })
      .eq('owner_id', user.id)
      .eq('deleted_at', profile.deleted_at)

    profile.deleted_at = null
  }

  const { data: memberships } = await ctx.db
    .from('organization_members')
    .select('role, organizations!inner(id, name, short_name, slug, logo_url, deleted_at)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .is('organizations.deleted_at', null)

  const organizations = (memberships ?? []).map((m: Record<string, unknown>) => {
    const { deleted_at: _deletedAt, ...org } = m.organizations as Record<string, unknown>
    return { ...org, role: m.role }
  })

  return successResponse({
    profile: profile ?? { id: user.id, email: user.email },
    organizations,
    needs_onboarding: organizations.length === 0,
  })
}
