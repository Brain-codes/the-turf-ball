import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { oneOf, str, validate } from '../../_shared/validation.ts'

const STATUSES = ['scheduled', 'live', 'paused', 'completed', 'cancelled'] as const

export async function updateSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    title: [str(0, 80)],
    venue: [str(0, 120)],
    notes: [str(0, 1000)],
    status: [oneOf(STATUSES)],
  })

  const patch: Record<string, unknown> = {}
  for (const f of ['title', 'venue', 'notes', 'status'] as const) {
    if (body[f] !== undefined) patch[f] = body[f]
  }
  if (body.kickoff_at !== undefined) {
    const k = new Date(String(body.kickoff_at))
    if (!Number.isNaN(k.getTime())) {
      patch.kickoff_at = k.toISOString()
      patch.session_date = k.toISOString().slice(0, 10)
    }
  }

  const { data, error } = await ctx.db
    .from('sessions')
    .update(patch)
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Session updated')
}
