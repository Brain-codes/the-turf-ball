/**
 * The balanced draft. Replaces an admin pasting the player list into ChatGPT
 * to shuffle it — one tap spreads quality evenly across teams (everyone
 * gets a keeper first, then outfield players by quality; see the note on
 * PositionGroup below for why defence/midfield/attack isn't part of this),
 * fully overridable afterwards by hand.
 *
 * Idempotent up to kickoff: calling this again before the competition goes
 * live soft-removes the previous draft and redraws from scratch. Once a
 * competition is 'live', this endpoint refuses — use the team-roster edit
 * endpoints instead, the same way editing one player's assignment does.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'

// Small-sided football (5-, 7-a-side) doesn't really have a back four and a
// front three — everyone covers ground, and a "position" on the player
// profile is often just where they happened to stand once. So the default
// is loose: only the keeper is treated as a distinct role, and every
// outfield player is balanced purely by quality. Groups that do play a more
// traditional 11-a-side shape (or just want the finer split) can flip
// "strict positioning" on per draft, which restores the full defence /
// midfield / attack buckets below.
type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD' | 'OUTFIELD'

const STRICT_GROUP_OF: Record<string, PositionGroup> = {
  GK: 'GK',
  RB: 'DEF', CB: 'DEF', LB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'FWD', RW: 'FWD', ST: 'FWD', CF: 'FWD',
}

const LOOSE_GROUP_OF: Record<string, PositionGroup> = {
  GK: 'GK',
  RB: 'OUTFIELD', CB: 'OUTFIELD', LB: 'OUTFIELD',
  CDM: 'OUTFIELD', CM: 'OUTFIELD', CAM: 'OUTFIELD', LM: 'OUTFIELD', RM: 'OUTFIELD',
  LW: 'OUTFIELD', RW: 'OUTFIELD', ST: 'OUTFIELD', CF: 'OUTFIELD',
}

interface DraftPlayer {
  player_id: string
  group: PositionGroup
  quality: number
}

/**
 * Snake order for n teams, optionally rotated to start from `startTeam`.
 * 0,1,2,...,n-1,n-1,...,2,1,0,0,1,2,... rotated so team counts stay within
 * 1 of each other no matter where the pool length lands — and so two draws
 * of the same pool don't always hand the "extra" player to the same team.
 */
function snakeOrder(teamCount: number, picks: number, startTeam = 0): number[] {
  const order: number[] = []
  let forward = true
  let round = 0
  while (order.length < picks) {
    const base = Array.from({ length: teamCount }, (_, i) => (startTeam + i) % teamCount)
    const seq = forward ? base : [...base].reverse()
    order.push(...seq)
    forward = !forward
    round++
    if (round > picks) break // safety valve, should never trigger
  }
  return order.slice(0, picks)
}

/** Fisher-Yates. Used to break quality ties randomly so a re-draw of an
 * identical pool (very common — most players share quality 0 early in a
 * competition) doesn't hand back the exact same teams every time. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function draftCompetition(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const competitionId = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const { data: competition } = await ctx.db
    .from('competitions')
    .select('id, status, team_count, period_id')
    .eq('id', competitionId)
    .single()

  if (!competition) throw notFound('Competition not found')

  if (competition.status === 'live' || competition.status === 'completed') {
    throw badRequest('This competition is already underway — edit team rosters directly instead of re-drawing')
  }

  const body = await ctx.body<{ strict_positions?: boolean }>()
  const strictPositions = body?.strict_positions === true
  const groupOf = strictPositions ? STRICT_GROUP_OF : LOOSE_GROUP_OF
  const groupsInOrder: PositionGroup[] = strictPositions ? ['GK', 'DEF', 'MID', 'FWD'] : ['GK', 'OUTFIELD']

  // Ensure `team_count` teams exist. Re-drafting reuses whatever teams
  // already have names/captains set — only the roster is redrawn, not the
  // team identities themselves.
  const { data: existingTeams } = await ctx.db
    .from('competition_teams')
    .select('id, sort_order')
    .eq('competition_id', competitionId)
    .order('sort_order', { ascending: true })

  let teams = existingTeams ?? []
  if (teams.length < competition.team_count) {
    // "Team A", "Team B", ... so a freshly-drawn team never sits nameless
    // waiting for someone to notice — the admin renames it when they're
    // ready, but there's never a blank row in the meantime.
    const toCreate = Array.from({ length: competition.team_count - teams.length }, (_, i) => ({
      organization_id: member.organizationId,
      competition_id: competitionId,
      sort_order: teams.length + i,
      name: `Team ${String.fromCharCode(65 + teams.length + i)}`,
    }))
    const { data: created, error: createErr } = await ctx.db
      .from('competition_teams')
      .insert(toCreate)
      .select('id, sort_order')
    if (createErr) throw new Error(createErr.message)
    teams = [...teams, ...(created ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  }
  teams = teams.slice(0, competition.team_count)

  // Pull the current roster intent plus each player's quality (goals per
  // appearance this period; 0 for anyone with no history — new players are
  // never penalized, just untiered).
  const { data: players } = await ctx.db
    .from('competition_players')
    .select('player_id, players(position)')
    .eq('competition_id', competitionId)
    .is('removed_at', null)

  if (!players || players.length === 0) {
    throw badRequest('No one has joined this competition yet')
  }

  // total_points is the org's own composite score — goals, assists, clean
  // sheets, cards and punctuality, weighted by whatever scoring rules this
  // group has set (see org_settings / scoring_rules). Balancing on goals
  // alone rated a scoreless defender or keeper as "no quality" at all, which
  // made a strong defensive team look weaker than one with a single
  // poacher. total_points is the same number the leaderboard already ranks
  // players on, so "quality" here means the same thing it means everywhere
  // else in the app.
  const { data: stats } = await ctx.db
    .from('player_period_stats')
    .select('player_id, total_points, appearances')
    .eq('period_id', competition.period_id)
    .in('player_id', players.map((p) => p.player_id))

  const qualityOf = new Map<string, number>()
  for (const s of stats ?? []) {
    // Smoothed by a few phantom appearances so one big game isn't treated
    // as a proven rate — see handlers/balance.ts for the full reasoning.
    // Same formula in both places on purpose: the number the draft
    // optimizes for and the number shown afterwards must agree.
    qualityOf.set(s.player_id, s.total_points / (s.appearances + 3))
  }

  const defaultGroup: PositionGroup = strictPositions ? 'MID' : 'OUTFIELD'
  const pool: DraftPlayer[] = players.map((p) => {
    const position = (p.players as unknown as { position: string | null })?.position
    return {
      player_id: p.player_id,
      group: (position && groupOf[position]) || defaultGroup,
      quality: qualityOf.get(p.player_id) ?? 0,
    }
  })

  // Highest quality first within each bucket. Ties (very common — most
  // players carry quality 0 until they've scored) are broken by a random
  // shuffle rather than array order, so re-drafting an unchanged pool still
  // produces a genuinely different split instead of the identical one.
  const buckets: Partial<Record<PositionGroup, DraftPlayer[]>> = {}
  for (const g of groupsInOrder) buckets[g] = []
  for (const p of shuffle(pool)) (buckets[p.group] ??= []).push(p)
  for (const g of Object.keys(buckets) as PositionGroup[]) {
    buckets[g]!.sort((a, b) => b.quality - a.quality)
  }

  // One continuous snake pass across the groups in priority order (keeper
  // first, so every team gets its own before the rest of the split begins)
  // rather than restarting the snake per bucket. Restarting per bucket let
  // each bucket's leftover "odd one out" land on the same edge team every
  // time. A single pass over the whole pool guarantees every team's total
  // differs by at most 1, which is the actual promise "drawn evenly" makes.
  const queue = groupsInOrder.flatMap((g) => buckets[g] ?? [])
  const startTeam = Math.floor(Math.random() * teams.length)
  const order = snakeOrder(teams.length, queue.length, startTeam)

  const assignment: { team_id: string; player_id: string }[] = []
  const teamCounts = new Map(teams.map((t) => [t.id, 0]))
  queue.forEach((player, i) => {
    const team = teams[order[i]]
    assignment.push({ team_id: team.id, player_id: player.player_id })
    teamCounts.set(team.id, (teamCounts.get(team.id) ?? 0) + 1)
  })

  // Soft-remove the previous draft, then write the fresh one. Never a hard
  // delete — history of who played for whom survives a re-roll.
  await ctx.db
    .from('competition_team_players')
    .update({ removed_at: new Date().toISOString() })
    .eq('competition_id', competitionId)
    .is('removed_at', null)

  const rows = assignment.map((a) => ({
    organization_id: member.organizationId,
    competition_id: competitionId,
    competition_team_id: a.team_id,
    player_id: a.player_id,
    created_by: member.user.id,
  }))

  const { data: inserted, error: insertErr } = await ctx.db
    .from('competition_team_players')
    .insert(rows)
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, position, jersey_number), competition_team_id')

  if (insertErr) throw new Error(insertErr.message)

  await ctx.db.from('competitions').update({ status: 'drafting_teams' }).eq('id', competitionId)

  // Overflow report: which teams landed above the base squad size, purely
  // informational — the draw is never blocked by an uneven headcount.
  const base = Math.floor(pool.length / teams.length)
  const overflowTeams = teams
    .map((t) => ({ team_id: t.id, count: teamCounts.get(t.id) ?? 0 }))
    .filter((t) => t.count > base)
    .map((t) => ({ team_id: t.team_id, count_over_base: t.count - base }))

  const balanceReport = teams.map((t) => {
    const teamPlayers = pool.filter((p) => assignment.some((a) => a.team_id === t.id && a.player_id === p.player_id))
    const avgQuality = teamPlayers.length
      ? teamPlayers.reduce((sum, p) => sum + p.quality, 0) / teamPlayers.length
      : 0
    const positionSpread = groupsInOrder.reduce((acc, g) => {
      acc[g] = teamPlayers.filter((p) => p.group === g).length
      return acc
    }, {} as Record<PositionGroup, number>)
    return { team_id: t.id, player_count: teamCounts.get(t.id) ?? 0, average_quality: Number(avgQuality.toFixed(2)), position_spread: positionSpread }
  })

  return successResponse(
    { team_players: inserted, balance_report: balanceReport, overflow_teams: overflowTeams },
    overflowTeams.length > 0
      ? `Teams drawn. ${overflowTeams.length} team(s) have more players than the rest — that's fine, just uneven turnout.`
      : 'Teams drawn evenly',
  )
}
