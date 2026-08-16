import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { resolvePeriod } from '../../_shared/helpers.ts'

/** A player's profile: who they are, this month's numbers, recent form, awards. */
export async function getPlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const playerId = ctx.segments[0]

  const { data: player } = await ctx.db
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!player) throw notFound('Player not found')

  const period = await resolvePeriod(ctx.db, member.organizationId, ctx.query.get('period_id'))

  const { data: stats } = await ctx.db
    .from('player_period_stats')
    .select('*')
    .eq('player_id', playerId)
    .eq('period_id', period.id)
    .maybeSingle()

  // Every period they have ever played, so the profile shows a career, not
  // just a snapshot.
  const { data: history } = await ctx.db
    .from('player_period_stats')
    .select('*, periods(label, year, month, status)')
    .eq('player_id', playerId)
    .order('computed_at', { ascending: false })
    .limit(24)

  const { data: awards } = await ctx.db
    .from('awards')
    .select('value, awarded_at, award_types(code, name, icon), periods(label)')
    .eq('player_id', playerId)
    .order('awarded_at', { ascending: false })

  // Recent form: the last few matches with what they did in each.
  const { data: events } = await ctx.db
    .from('match_events')
    .select('event_type, created_at, match_id, matches(sequence, sessions(session_date))')
    .eq('player_id', playerId)
    .is('voided_at', null)
    .order('created_at', { ascending: false })
    .limit(60)

  const form = new Map<string, { date: string | null; goals: number; assists: number; cards: number }>()
  for (const e of events ?? []) {
    const match = e.matches as unknown as Record<string, unknown> | null
    const session = match?.sessions as Record<string, unknown> | null
    const key = String(e.match_id)
    const entry = form.get(key) ?? {
      date: (session?.session_date as string) ?? null,
      goals: 0,
      assists: 0,
      cards: 0,
    }
    if (e.event_type === 'goal') entry.goals++
    if (e.event_type === 'assist') entry.assists++
    if (e.event_type === 'yellow_card' || e.event_type === 'red_card') entry.cards++
    form.set(key, entry)
  }

  return successResponse({
    ...player,
    period,
    stats: stats ?? null,
    history: history ?? [],
    awards: awards ?? [],
    recent_form: Array.from(form.values()).slice(0, 8),
  })
}
