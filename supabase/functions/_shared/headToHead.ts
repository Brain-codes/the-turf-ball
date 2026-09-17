/**
 * Head to head — two players side by side, from any two teams.
 *
 * Shared by the public `/public/h2h*` routes (anyone, public teams only) and
 * the admin `/stats/h2h*` routes (a signed-in member, who can also see their
 * own group's players even when that group isn't public). The only
 * difference between the two is `ownOrgId`: everything a caller can see is
 * "public, live teams" plus, for an admin, their own team.
 *
 * Numbers come from `player_alltime_stats`, the same source as the global
 * table, so a player's figures here always match what the table shows.
 */

import type { SupabaseClient } from './db.ts'
import { badRequest, notFound } from './errors.ts'

const TEAM_COLUMNS = 'id, name, short_name, slug, logo_url, is_public, status, deleted_at'
const PLAYER_COLUMNS = 'id, organization_id, display_name, whatsapp_nickname, photo_url, jersey_number, position, status'

/** Players who are genuinely on a roster — never pending, merged-away or guests. */
const ROSTER_STATUSES = ['active', 'inactive']

interface TeamRow {
  id: string
  name: string
  short_name: string | null
  slug: string
  logo_url: string | null
  is_public: boolean
  status: string
  deleted_at: string | null
}

function isVisibleTeam(team: TeamRow | null, ownOrgId?: string): boolean {
  if (!team || team.deleted_at) return false
  if (ownOrgId && team.id === ownOrgId) return true
  return team.is_public && team.status === 'active'
}

function projectTeam(team: TeamRow, ownOrgId?: string) {
  return {
    id: team.id,
    name: team.name,
    short_name: team.short_name,
    slug: team.slug,
    logo_url: team.logo_url,
    is_own: !!ownOrgId && team.id === ownOrgId,
    // Tells the app whether a shared public link will open for everyone.
    is_public: team.is_public && team.status === 'active',
  }
}

function projectPlayer(p: Record<string, unknown>) {
  return {
    id: p.id,
    display_name: p.display_name,
    whatsapp_nickname: p.whatsapp_nickname,
    photo_url: p.photo_url,
    jersey_number: p.jersey_number,
    position: p.position,
  }
}

/** Teams the caller may pick from. The caller's own team is always listed first. */
export async function searchH2HTeams(db: SupabaseClient, search: string | null, ownOrgId?: string) {
  let q = db
    .from('organizations')
    .select(TEAM_COLUMNS)
    .eq('is_public', true)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')
    .limit(20)
  if (search) q = q.ilike('name', `%${search}%`)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const teams = (data ?? []) as TeamRow[]

  if (ownOrgId && !teams.some((t) => t.id === ownOrgId)) {
    const { data: own } = await db.from('organizations').select(TEAM_COLUMNS).eq('id', ownOrgId).maybeSingle()
    const ownTeam = own as TeamRow | null
    if (ownTeam && (!search || ownTeam.name.toLowerCase().includes(search.toLowerCase()))) {
      teams.unshift(ownTeam)
    }
  }

  teams.sort((a, b) => Number(b.id === ownOrgId) - Number(a.id === ownOrgId))
  return teams.filter((t) => isVisibleTeam(t, ownOrgId)).map((t) => projectTeam(t, ownOrgId))
}

/**
 * Players the caller may pick from. With `teamId`, only that team (which
 * must itself be visible); without, every visible team — own team first.
 */
export async function searchH2HPlayers(
  db: SupabaseClient,
  opts: { search: string | null; teamId: string | null; ownOrgId?: string },
) {
  const { search, teamId, ownOrgId } = opts

  const base = () => {
    let q = db
      .from('players')
      .select(`${PLAYER_COLUMNS}, organizations!inner(${TEAM_COLUMNS})`)
      .in('status', ROSTER_STATUSES)
      .is('organizations.deleted_at', null)
      .order('display_name')
      .limit(25)
    if (search) q = q.ilike('display_name', `%${search}%`)
    return q
  }

  const queries = []
  if (teamId) {
    queries.push(base().eq('organization_id', teamId))
  } else {
    if (ownOrgId) queries.push(base().eq('organization_id', ownOrgId))
    queries.push(base().eq('organizations.is_public', true).eq('organizations.status', 'active'))
  }

  const results = await Promise.all(queries)
  const seen = new Set<string>()
  const rows = []
  for (const { data, error } of results) {
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const team = r.organizations as TeamRow
      if (seen.has(String(r.id)) || !isVisibleTeam(team, ownOrgId)) continue
      seen.add(String(r.id))
      rows.push({ player: projectPlayer(r), team: projectTeam(team, ownOrgId) })
    }
  }
  return rows.slice(0, 30)
}

const STAT_KEYS = [
  'appearances', 'goals', 'assists', 'own_goals', 'clean_sheets',
  'saves', 'penalty_saves', 'yellow_cards', 'red_cards', 'periods_played',
] as const

async function loadSide(db: SupabaseClient, playerId: string, ownOrgId?: string) {
  const { data: player, error } = await db
    .from('players')
    .select(`${PLAYER_COLUMNS}, organizations!inner(${TEAM_COLUMNS})`)
    .eq('id', playerId)
    .in('status', ROSTER_STATUSES)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const team = (player?.organizations ?? null) as TeamRow | null
  // A player on a private team looks exactly like one that doesn't exist.
  if (!player || !isVisibleTeam(team, ownOrgId)) throw notFound('That player is not available')

  const [{ data: stats }, { data: awards }] = await Promise.all([
    db
      .from('player_alltime_stats')
      .select(STAT_KEYS.join(', '))
      .eq('player_id', playerId)
      .eq('organization_id', team!.id)
      .maybeSingle(),
    db
      .from('awards')
      .select('award_types(name)')
      .eq('player_id', playerId),
  ])

  const s = (stats ?? {}) as Record<string, number | null>
  const totals = Object.fromEntries(STAT_KEYS.map((k) => [k, Number(s[k] ?? 0)])) as Record<typeof STAT_KEYS[number], number>
  const apps = totals.appearances
  const perGame = (n: number) => (apps > 0 ? Math.round((n / apps) * 100) / 100 : 0)

  // Award counts by name, e.g. { "Player of the Month": 2 }.
  const awardCounts: Record<string, number> = {}
  for (const a of (awards ?? []) as unknown as { award_types: { name: string } | null }[]) {
    const name = a.award_types?.name
    if (name) awardCounts[name] = (awardCounts[name] ?? 0) + 1
  }

  return {
    player: projectPlayer(player),
    team: projectTeam(team!, ownOrgId),
    totals,
    per_game: {
      goals: perGame(totals.goals),
      assists: perGame(totals.assists),
      goal_involvements: perGame(totals.goals + totals.assists),
      clean_sheets: perGame(totals.clean_sheets),
      saves: perGame(totals.saves),
    },
    awards: awardCounts,
  }
}

export async function loadHeadToHead(db: SupabaseClient, query: URLSearchParams, ownOrgId?: string) {
  const a = query.get('a')
  const b = query.get('b')
  const uuid = /^[0-9a-f-]{36}$/i
  if (!a || !b || !uuid.test(a) || !uuid.test(b)) throw badRequest('Pick two players to compare')
  if (a === b) throw badRequest('Pick two different players')

  const [left, right] = await Promise.all([loadSide(db, a, ownOrgId), loadSide(db, b, ownOrgId)])
  return { a: left, b: right }
}
