/**
 * Delete my account, with a 30-day grace period. HANDOFF.md "Delete my
 * account" — DECIDED 16 Aug: deleting an account also deletes the
 * organizations it owns, but only behind an explicit warning naming what's
 * inside each one. Two-step: preview, then confirm.
 *
 * During the 30-day window the account and any organizations it owns are
 * soft-deleted (deleted_at set on both) — hidden, not destroyed. A daily
 * pg_cron job (see migration 20260816150000) hard-deletes anything whose
 * grace period has expired. Logging back in within the window reactivates
 * everything (see auth/handlers/me.ts).
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'
import { badRequest } from '../../_shared/errors.ts'

interface OrgPreview {
  id: string
  name: string
  player_count: number
  session_count: number
  other_member_count: number
}

async function ownedOrgsPreview(ctx: Ctx, userId: string): Promise<OrgPreview[]> {
  const { data: orgs } = await ctx.db
    .from('organizations')
    .select('id, name')
    .eq('owner_id', userId)
    .is('deleted_at', null)

  const previews: OrgPreview[] = []
  for (const org of orgs ?? []) {
    const [{ count: playerCount }, { count: sessionCount }, { count: memberCount }] = await Promise.all([
      ctx.db.from('players').select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id).eq('status', 'active'),
      ctx.db.from('sessions').select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id),
      ctx.db.from('organization_members').select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id).eq('status', 'active').neq('user_id', userId),
    ])
    previews.push({
      id: org.id,
      name: org.name,
      player_count: playerCount ?? 0,
      session_count: sessionCount ?? 0,
      other_member_count: memberCount ?? 0,
    })
  }
  return previews
}

/** Step 1 — show exactly what deleting the account will take with it. */
export async function previewDeleteAccount(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)
  const organizations = await ownedOrgsPreview(ctx, user.id)

  return successResponse({
    organizations,
    warning: organizations.length > 0
      ? 'Deleting your account also deletes the group(s) you own below. Everything is recoverable for 30 days if you log back in — after that it is gone for good.'
      : 'Your account will be deleted. You have 30 days to log back in and undo this before it is permanent.',
  })
}

/** Step 2 — the client has seen the preview and explicitly confirmed. */
export async function confirmDeleteAccount(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)
  const body = await ctx.body<{ confirm?: boolean }>()

  if (body.confirm !== true) {
    throw badRequest('Please confirm you understand what will be deleted')
  }

  const deletedAt = new Date().toISOString()

  const { error: orgErr } = await ctx.db
    .from('organizations')
    .update({ deleted_at: deletedAt })
    .eq('owner_id', user.id)
    .is('deleted_at', null)
  if (orgErr) throw new Error(orgErr.message)

  const { error: profileErr } = await ctx.db
    .from('profiles')
    .update({ deleted_at: deletedAt })
    .eq('id', user.id)
  if (profileErr) throw new Error(profileErr.message)

  // Sign the user out everywhere immediately — deletion should not leave an
  // active session behind. Best-effort: the account is already soft-deleted
  // even if this call fails.
  try {
    await ctx.db.auth.admin.signOut(user.id, 'global')
  } catch (err) {
    ctx.log.warn('could not revoke sessions on delete', { error: String(err) })
  }

  return successResponse(
    { deleted_at: deletedAt },
    'Your account will be permanently deleted in 30 days. Log back in any time before then to undo this.',
  )
}
