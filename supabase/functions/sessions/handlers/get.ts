import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'

export async function getSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]

  const { data: session } = await ctx.db
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!session) throw notFound('Session not found')

  // Heartbeat: the live view polls this endpoint every 30s while a session
  // is live. materialize_and_flag_sessions() uses how fresh this is to tell
  // "organizer still on the live screen" apart from "nobody's watching"
  // before deciding whether to prompt or just auto-close a quiet session.
  if (session.status === 'live') {
    await ctx.db
      .from('sessions')
      .update({ last_viewed_at: new Date().toISOString() })
      .eq('id', sessionId)
    session.last_viewed_at = new Date().toISOString()
  }

  const { data: attendance } = await ctx.db
    .from('session_attendance')
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, jersey_number, position)')
    .eq('session_id', sessionId)

  const { data: matches } = await ctx.db
    .from('matches')
    .select('*, match_players(player_id, side, is_goalkeeper, players(id, display_name, whatsapp_nickname, photo_url, jersey_number))')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true })

  return successResponse({
    ...session,
    attendance: attendance ?? [],
    matches: matches ?? [],
  })
}
