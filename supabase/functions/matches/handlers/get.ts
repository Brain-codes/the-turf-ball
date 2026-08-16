import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'

export async function getMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.segments[0]

  const { data: match } = await ctx.db
    .from('matches')
    .select('*, sessions(id, session_date, kickoff_at, status, period_id)')
    .eq('id', matchId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!match) throw notFound('Match not found')

  const { data: players } = await ctx.db
    .from('match_players')
    .select('*, players(id, display_name, photo_url, jersey_number, position)')
    .eq('match_id', matchId)

  const { data: events } = await ctx.db
    .from('match_events')
    .select('*, players!match_events_player_id_fkey(display_name, jersey_number)')
    .eq('match_id', matchId)
    .is('voided_at', null)
    .order('created_at', { ascending: true })

  return successResponse({ ...match, players: players ?? [], events: events ?? [] })
}
