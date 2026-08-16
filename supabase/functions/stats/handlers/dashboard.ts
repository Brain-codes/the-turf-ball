import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { resolvePeriod } from '../../_shared/helpers.ts'

/** Everything the home screen needs, in one request. */
export async function dashboard(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const period = await resolvePeriod(ctx.db, member.organizationId, ctx.query.get('period_id'))

  const { data: stats } = await ctx.db
    .from('player_period_stats')
    .select('*, players(id, display_name, photo_url, jersey_number, position)')
    .eq('period_id', period.id)
    .order('rank', { ascending: true })

  const played = (stats ?? []).filter((s: Record<string, unknown>) => (s.appearances as number) > 0)

  const { count: playerCount } = await ctx.db
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', member.organizationId)
    .eq('status', 'active')

  // The counted rule (HANDOFF.md feature 3): a session counts unless it was
  // flagged inactive by the scheduler and never approved by an admin.
  const { count: sessionCount } = await ctx.db
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('period_id', period.id)
    .eq('status', 'completed')
    .or('flagged_inactive_at.is.null,approved_at.not.is.null')

  const { data: recentSessions } = await ctx.db
    .from('sessions')
    .select('id, session_date, kickoff_at, status, title, matches(id, sequence, side_a_score, side_b_score, side_a_label, side_b_label)')
    .eq('organization_id', member.organizationId)
    .order('session_date', { ascending: false })
    .limit(5)

  const { data: liveSession } = await ctx.db
    .from('sessions')
    .select('id, session_date, kickoff_at')
    .eq('organization_id', member.organizationId)
    .eq('status', 'live')
    .maybeSingle()

  const totals = played.reduce(
    (acc: Record<string, number>, s: Record<string, number>) => ({
      goals: acc.goals + (s.goals ?? 0),
      assists: acc.assists + (s.assists ?? 0),
      clean_sheets: acc.clean_sheets + (s.clean_sheets ?? 0),
      cards: acc.cards + (s.yellow_cards ?? 0) + (s.red_cards ?? 0),
    }),
    { goals: 0, assists: 0, clean_sheets: 0, cards: 0 },
  )

  const topBy = (field: string) => {
    const sorted = [...played].sort(
      (a: Record<string, number>, b: Record<string, number>) => (b[field] ?? 0) - (a[field] ?? 0),
    )
    return sorted[0] && (sorted[0] as Record<string, number>)[field] > 0 ? sorted[0] : null
  }

  return successResponse({
    period,
    totals: { ...totals, players: playerCount ?? 0, sessions: sessionCount ?? 0 },
    leaderboard: played.slice(0, 5),
    top_scorer: topBy('goals'),
    top_assister: topBy('assists'),
    top_keeper: topBy('clean_sheets'),
    recent_sessions: recentSessions ?? [],
    live_session: liveSession ?? null,
  })
}
