/**
 * The global leaderboard — livescore-style tables spanning every public
 * team, not one group's private table. Read-only, unauthenticated, same
 * rules as the rest of `public`: never leak anything an org hasn't opted
 * into showing.
 */

import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { pageParams } from '../../_shared/helpers.ts'

const PLAYER_SORT_FIELDS = ['goals', 'assists', 'appearances', 'clean_sheets', 'penalty_saves', 'saves'] as const
const TEAM_SORT_FIELDS = ['goals', 'assists', 'appearances', 'clean_sheets', 'penalty_saves'] as const

function resolveSort<T extends readonly string[]>(fields: T, requested: string | null, fallback: T[number]): T[number] {
  return (fields as readonly string[]).includes(requested ?? '') ? (requested as T[number]) : fallback
}

/** Every global players/teams query starts from public, live organizations only. */
function scopeToPublicOrgs<Q>(q: Q): Q {
  return (q as unknown as {
    eq: (c: string, v: unknown) => unknown
    is: (c: string, v: unknown) => unknown
  })
    .eq('organizations.is_public', true)
    .eq('organizations.status', 'active')
    .is('organizations.deleted_at', null) as Q
}

export async function getGlobalPlayers(ctx: Ctx): Promise<Response> {
  const { page, perPage, from, to } = pageParams(ctx.query)
  const sort = resolveSort(PLAYER_SORT_FIELDS, ctx.query.get('sort'), 'goals')
  const search = ctx.query.get('search')?.trim()

  let q = ctx.db
    .from('player_alltime_stats')
    .select(
      '*, players!inner(id, display_name, whatsapp_nickname, photo_url, jersey_number, position, status), organizations!inner(id, name, short_name, slug, logo_url, is_public, status, deleted_at)',
      { count: 'exact' },
    )
    .gt('appearances', 0)
    .neq('players.status', 'guest')

  q = scopeToPublicOrgs(q)
  if (search) q = q.ilike('players.display_name', `%${search}%`)

  const { data, error, count } = await q
    .order(sort, { ascending: false })
    .range(from, to)

  if (error) throw new Error(error.message)

  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    player: r.players,
    team: r.organizations,
    appearances: r.appearances,
    goals: r.goals,
    own_goals: r.own_goals,
    assists: r.assists,
    clean_sheets: r.clean_sheets,
    penalty_saves: r.penalty_saves,
    saves: r.saves,
  }))

  return successResponse(rows, 'Global players', { ...paginate(page, perPage, count ?? rows.length), sort })
}

export async function getGlobalTeams(ctx: Ctx): Promise<Response> {
  const { page, perPage, from, to } = pageParams(ctx.query)
  const sort = resolveSort(TEAM_SORT_FIELDS, ctx.query.get('sort'), 'goals')
  const search = ctx.query.get('search')?.trim()

  let q = ctx.db
    .from('org_alltime_stats')
    .select(
      '*, organizations!inner(id, name, short_name, slug, logo_url, location, is_public, status, deleted_at)',
      { count: 'exact' },
    )

  q = scopeToPublicOrgs(q)
  if (search) q = q.ilike('organizations.name', `%${search}%`)

  const { data, error, count } = await q
    .order(sort, { ascending: false })
    .range(from, to)

  if (error) throw new Error(error.message)

  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    team: r.organizations,
    player_count: r.player_count,
    appearances: r.appearances,
    goals: r.goals,
    own_goals: r.own_goals,
    assists: r.assists,
    clean_sheets: r.clean_sheets,
    penalty_saves: r.penalty_saves,
    saves: r.saves,
  }))

  return successResponse(rows, 'Global teams', { ...paginate(page, perPage, count ?? rows.length), sort })
}
