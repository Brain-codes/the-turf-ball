/**
 * One session, in full — the match-day equivalent of the monthly breakdown.
 *
 * Built live every time rather than frozen. A month is frozen because closing
 * it is a decision with awards attached; a session has no such moment, and its
 * numbers can still be corrected inside the edit window.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'

export async function sessionReport(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]

  const { data: session, error: loadError } = await ctx.db
    .from('sessions')
    .select('id, session_date, status')
    .eq('id', sessionId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (loadError) throw new Error(`Could not load the session: ${loadError.message}`)
  if (!session) throw notFound('Session not found')

  const { data, error } = await ctx.db.rpc('build_session_report', { p_session: sessionId })
  if (error) throw new Error(error.message)

  return successResponse(
    { ...data, live: session.status === 'live' || session.status === 'paused' },
    session.status === 'live' ? 'How it is going' : 'How it went',
  )
}
