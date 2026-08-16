/**
 * The public share page. No authentication — this is the link dropped in a
 * WhatsApp group, opened on mobile data by twenty people at once.
 *
 * Three rules govern everything here:
 *   1. Read-only. There is no write path in this function at all.
 *   2. Respect the organizer's visibility settings — if they hid photos or
 *      cards, this endpoint must not leak them.
 *   3. Never expose anything internal: no user accounts, no emails, no audit
 *      trail, no member list, no organization id beyond what the page needs.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { notFound } from '../../_shared/errors.ts'

interface PageContext {
  organizationId: string
  organization: Record<string, unknown>
  page: Record<string, unknown>
}

async function loadPage(ctx: Ctx, slug: string): Promise<PageContext> {
  const { data } = await ctx.db
    .from('public_pages')
    .select('*, organizations(id, name, short_name, slug, logo_url, description, location, venue, format, timezone)')
    .eq('slug', slug)
    .maybeSingle()

  // An unpublished page is indistinguishable from one that never existed.
  if (!data || !data.is_published) throw notFound('That page is not available')

  const org = data.organizations as Record<string, unknown>
  return { organizationId: String(org.id), organization: org, page: data }
}

/** Strip anything the organizer chose not to show. */
function projectPlayer(player: Record<string, unknown> | null, page: Record<string, unknown>) {
  if (!player) return null
  return {
    id: player.id,
    display_name: player.display_name,
    jersey_number: player.jersey_number,
    position: player.position,
    photo_url: page.show_photos ? player.photo_url : null,
  }
}

function projectStat(row: Record<string, unknown>, page: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    rank: row.rank,
    player: projectPlayer(row.players as Record<string, unknown>, page),
    appearances: row.appearances,
    goals: row.goals,
    assists: row.assists,
    clean_sheets: row.clean_sheets,
    total_points: row.total_points,
  }
  if (page.show_cards) {
    base.yellow_cards = row.yellow_cards
    base.red_cards = row.red_cards
  }
  if (page.show_punctuality) {
    base.punctuality_score = row.punctuality_score
  }
  return base
}

async function resolvePublicPeriod(ctx: Ctx, organizationId: string, requested: string | null) {
  if (requested) {
    const { data } = await ctx.db
      .from('periods')
      .select('id, label, status, year, month')
      .eq('id', requested)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (data) return data
  }
  const { data } = await ctx.db
    .from('periods')
    .select('id, label, status, year, month')
    .eq('organization_id', organizationId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) throw notFound('Nothing has been played yet')
  return data
}

/** The main page payload — everything above the fold, in one request. */
export async function getPublicPage(ctx: Ctx): Promise<Response> {
  const slug = ctx.segments[0]
  const { organizationId, organization, page } = await loadPage(ctx, slug)
  const period = await resolvePublicPeriod(ctx, organizationId, ctx.query.get('period_id'))

  const { data: stats } = await ctx.db
    .from('player_period_stats')
    .select('*, players(id, display_name, photo_url, jersey_number, position, status)')
    .eq('period_id', period.id)
    .gt('appearances', 0)
    .order('rank', { ascending: true })

  const rows = stats ?? []

  const { data: awards } = await ctx.db
    .from('awards')
    .select('value, breakdown, award_types(code, name, icon), players(id, display_name, photo_url, jersey_number)')
    .eq('period_id', period.id)

  const { data: periods } = await ctx.db
    .from('periods')
    .select('id, label, status')
    .eq('organization_id', organizationId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(24)

  let sessions: unknown[] = []
  if (page.show_sessions) {
    const { data } = await ctx.db
      .from('sessions')
      .select('id, session_date, title, status, matches(sequence, side_a_label, side_b_label, side_a_score, side_b_score)')
      .eq('period_id', period.id)
      .eq('status', 'completed')
      .order('session_date', { ascending: false })
      .limit(6)
    sessions = data ?? []
  }

  const totals = rows.reduce(
    (acc: Record<string, number>, r: Record<string, number>) => ({
      goals: acc.goals + (r.goals ?? 0),
      assists: acc.assists + (r.assists ?? 0),
    }),
    { goals: 0, assists: 0 },
  )

  const { count: sessionCount } = await ctx.db
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('period_id', period.id)
    .eq('status', 'completed')

  // Fire-and-forget view counter, incremented in the database so twenty people
  // opening the link at once cannot overwrite each other's count. Never awaited
  // — a counter must not delay the page.
  ctx.db.rpc('increment_page_view', { p_org: organizationId }).then(() => {}, () => {})

  const topBy = (field: string) => {
    const sorted = [...rows].sort(
      (a: Record<string, number>, b: Record<string, number>) => (b[field] ?? 0) - (a[field] ?? 0),
    )
    const best = sorted[0] as Record<string, unknown> | undefined
    return best && (best[field] as number) > 0
      ? { player: projectPlayer(best.players as Record<string, unknown>, page), value: best[field] }
      : null
  }

  return successResponse({
    organization: {
      name: organization.name,
      short_name: organization.short_name,
      slug: organization.slug,
      logo_url: organization.logo_url,
      description: organization.description,
      location: organization.location,
      venue: organization.venue,
      format: organization.format,
    },
    period,
    periods: periods ?? [],
    totals: {
      players: rows.length,
      sessions: sessionCount ?? 0,
      goals: totals.goals,
      assists: totals.assists,
    },
    leaderboard: rows.map((r: Record<string, unknown>) => projectStat(r, page)),
    awards: (awards ?? []).map((a: Record<string, unknown>) => ({
      type: a.award_types,
      value: a.value,
      player: projectPlayer(a.players as Record<string, unknown>, page),
    })),
    top_scorer: topBy('goals'),
    top_assister: topBy('assists'),
    top_keeper: topBy('clean_sheets'),
    sessions,
    settings: {
      show_photos: page.show_photos,
      show_cards: page.show_cards,
      show_punctuality: page.show_punctuality,
      show_sessions: page.show_sessions,
    },
  })
}

/** A single player's shareable card. */
export async function getPublicPlayer(ctx: Ctx): Promise<Response> {
  const [slug, , playerId] = ctx.segments
  const { organizationId, organization, page } = await loadPage(ctx, slug)
  const period = await resolvePublicPeriod(ctx, organizationId, ctx.query.get('period_id'))

  const { data: player } = await ctx.db
    .from('players')
    .select('id, display_name, photo_url, jersey_number, position')
    .eq('id', playerId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!player) throw notFound('Player not found')

  const { data: stats } = await ctx.db
    .from('player_period_stats')
    .select('*')
    .eq('player_id', playerId)
    .eq('period_id', period.id)
    .maybeSingle()

  const { data: awards } = await ctx.db
    .from('awards')
    .select('value, award_types(code, name, icon), periods(label)')
    .eq('player_id', playerId)
    .order('awarded_at', { ascending: false })
    .limit(20)

  const { data: history } = await ctx.db
    .from('player_period_stats')
    .select('goals, assists, appearances, total_points, periods(label, year, month)')
    .eq('player_id', playerId)
    .order('computed_at', { ascending: false })
    .limit(12)

  return successResponse({
    organization: { name: organization.name, slug: organization.slug, logo_url: organization.logo_url },
    period,
    player: projectPlayer(player, page),
    stats: stats ? projectStat({ ...stats, players: player }, page) : null,
    awards: awards ?? [],
    history: history ?? [],
  })
}

/** One session's results. */
export async function getPublicSession(ctx: Ctx): Promise<Response> {
  const [slug, , sessionId] = ctx.segments
  const { organizationId, organization, page } = await loadPage(ctx, slug)

  if (!page.show_sessions) throw notFound('That page is not available')

  const { data: session } = await ctx.db
    .from('sessions')
    .select('id, session_date, title, status, venue')
    .eq('id', sessionId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!session) throw notFound('Session not found')

  const { data: matches } = await ctx.db
    .from('matches')
    .select('id, sequence, side_a_label, side_b_label, side_a_score, side_b_score, status')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true })

  const { data: events } = await ctx.db
    .from('match_events')
    .select('match_id, event_type, minute, players!match_events_player_id_fkey(display_name, jersey_number)')
    .eq('session_id', sessionId)
    .is('voided_at', null)
    .in('event_type', ['goal', 'own_goal', 'assist'])
    .order('created_at', { ascending: true })

  return successResponse({
    organization: { name: organization.name, slug: organization.slug, logo_url: organization.logo_url },
    session,
    matches: matches ?? [],
    events: events ?? [],
  })
}
