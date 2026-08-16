/**
 * Approve a flagged session. HANDOFF.md feature 3: the scheduler flags a
 * session inactive when it passed its end time with no attendance and no
 * matches. It still shows on the dashboard, clearly labelled, but is
 * excluded from every accumulated total until an admin approves it — at
 * which point it counts like any other session.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest } from '../../_shared/errors.ts'

export async function approveSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  const { data: session } = await ctx.db
    .from('sessions')
    .select('id, flagged_inactive_at, approved_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session?.flagged_inactive_at) {
    throw badRequest('That session was not flagged, so there is nothing to approve')
  }
  if (session.approved_at) {
    throw badRequest('That session is already approved')
  }

  const { data, error } = await ctx.db
    .from('sessions')
    .update({ approved_at: new Date().toISOString(), approved_by: member.user.id })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Session approved — it now counts towards the totals')
}
