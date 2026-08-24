/**
 * Round-robin fixture generation — the circle method. Fixes team 1, rotates
 * the rest through n-1 (even) or n (odd, one bye per round) rounds. Verified
 * against a real WhatsApp fixture list: 4 teams, double round-robin gives
 * 4×3/2 × 2 = 12 fixtures, matching a manually-written list exactly.
 *
 * Generating is re-runnable: calling it again replaces the standing
 * schedule with a fresh one built from the (possibly updated) settings,
 * the same way re-drafting teams replaces the previous draw. It refuses
 * once the competition has gone live — by then at least one fixture has a
 * real match attached, and regenerating would orphan it.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { int, uuid, validate } from '../../_shared/validation.ts'

interface Pairing { home: string; away: string }

/** One leg of the circle method. n teams -> n-1 (even) or n (odd) rounds. */
function circleMethod(teamIds: string[]): Pairing[][] {
  const ids = [...teamIds]
  const bye = ids.length % 2 !== 0
  if (bye) ids.push('__BYE__')

  const n = ids.length
  const rounds: Pairing[][] = []
  const arr = [...ids]

  for (let r = 0; r < n - 1; r++) {
    const roundPairs: Pairing[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a !== '__BYE__' && b !== '__BYE__') {
        // Alternate home/away by round so nobody is always "home" on paper.
        roundPairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a })
      }
    }
    rounds.push(roundPairs)
    // Rotate all but the first element.
    arr.splice(1, 0, arr.pop()!)
  }
  return rounds
}

const DEFAULT_BREAK_MINUTES = 5
const DEFAULT_DAY_STARTS_AT = '16:00'
const DEFAULT_MATCH_MINUTES = 20

interface FixtureSettings {
  match_duration_minutes: number | null
  day_starts_at: string | null
  day_ends_at: string | null
  evening_starts_at: string | null
  evening_ends_at: string | null
  matches_per_day: number | null
  concurrent_matches: number
  break_between_matches_minutes: number
  split_into_halves: boolean
  halftime_break_minutes: number | null
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

interface Window { start: string; end: string | null }

/**
 * The plan a kickoff slot actually occupies isn't just the match itself —
 * it's the match, plus a halftime break if the group plays halves, plus the
 * gap before the next match can start. This is the one number everything
 * else (how many matches fit in a window, how far apart kickoffs land) is
 * built from.
 */
function slotMinutes(perMatch: number, settings: FixtureSettings): number {
  const halftime = settings.split_into_halves ? (settings.halftime_break_minutes ?? 0) : 0
  return perMatch + halftime + settings.break_between_matches_minutes
}

/**
 * Schedules every pairing onto a kickoff time. One pass handles single-day
 * and multi-day identically (a single day is just a range of length 1),
 * and every day is walked through its play window(s) in order — a morning
 * session then, if set, a separate evening session — before moving to the
 * next day. Concurrent matches share a kickoff time instead of each
 * needing its own slot.
 *
 * The times this produces are a PLAN, not a constraint — a fixture reads
 * its own real start/stop time once it actually kicks off (MatchDay's
 * clock already runs off elapsed real time, never off this schedule).
 * This only exists so there's a sensible running order to begin with.
 */
function scheduleFixtures(
  pairings: Pairing[],
  startsOn: string,
  endsOn: string,
  settings: FixtureSettings,
): { scheduledAt: (string | null)[]; duration: (number | null)[]; extendedEndsOn: string | null } {
  const concurrency = Math.max(1, settings.concurrent_matches)

  const windows: Window[] = []
  if (settings.day_starts_at || settings.day_ends_at || !settings.evening_starts_at) {
    windows.push({ start: settings.day_starts_at ?? DEFAULT_DAY_STARTS_AT, end: settings.day_ends_at })
  }
  if (settings.evening_starts_at && settings.evening_ends_at) {
    windows.push({ start: settings.evening_starts_at, end: settings.evening_ends_at })
  }

  // Total bounded minutes across all of a day's windows — used to size the
  // match length automatically when nobody set one explicitly.
  const boundedWindowMinutes = windows
    .filter((w) => w.end)
    .reduce((sum, w) => sum + Math.max(1, timeToMinutes(w.end!) - timeToMinutes(w.start)), 0)

  let perMatch = settings.match_duration_minutes
  if (!perMatch && boundedWindowMinutes > 0) {
    // Auto-size to fit whatever's being asked of one day, same arithmetic
    // an organizer would do by hand — just accounting for halftime and the
    // between-match gap on top of playing time now, not just playing time.
    // `slotsNeeded` slots consume slotsNeeded*(perMatch+halftime) minutes of
    // play plus (slotsNeeded-1) gaps — the very last slot in a day needs no
    // trailing gap after it.
    const dayCount = Math.max(1, Math.round((new Date(`${endsOn}T00:00:00`).getTime() - new Date(`${startsOn}T00:00:00`).getTime()) / 86400000) + 1)
    const perDayTarget = settings.matches_per_day ?? Math.ceil(pairings.length / dayCount)
    const slotsNeeded = Math.max(1, Math.ceil(perDayTarget / concurrency))
    const halftime = settings.split_into_halves ? (settings.halftime_break_minutes ?? 0) : 0
    const gaps = settings.break_between_matches_minutes * (slotsNeeded - 1)
    perMatch = Math.max(1, Math.floor((boundedWindowMinutes - gaps - halftime * slotsNeeded) / slotsNeeded))
  }
  perMatch = perMatch ?? DEFAULT_MATCH_MINUTES

  const slotLen = slotMinutes(perMatch, settings)

  // Slots available per window (a window with no end is only usable when
  // it's the day's only window, and is treated as unbounded).
  const slotsPerWindow = windows.map((w) =>
    w.end ? Math.max(1, Math.floor((timeToMinutes(w.end) - timeToMinutes(w.start) + settings.break_between_matches_minutes) / slotLen)) : Infinity,
  )
  const slotsPerDay = slotsPerWindow.reduce((a, b) => a + b, 0)
  const capacityPerDay = settings.matches_per_day
    ?? (Number.isFinite(slotsPerDay) ? slotsPerDay * concurrency : null)

  // How many days are actually needed? If the organizer's own window/cap
  // can't fit everything in the range they picked, extend the last day
  // outward rather than silently dropping fixtures or cramming them —
  // the same "never block, just say so" posture the draft itself takes
  // with uneven squads.
  const requestedDays = Math.max(1, Math.round((new Date(`${endsOn}T00:00:00`).getTime() - new Date(`${startsOn}T00:00:00`).getTime()) / 86400000) + 1)
  const neededDays = capacityPerDay ? Math.max(requestedDays, Math.ceil(pairings.length / capacityPerDay)) : requestedDays

  let extendedEndsOn: string | null = null
  if (neededDays > requestedDays) {
    const extended = new Date(`${startsOn}T00:00:00`)
    extended.setDate(extended.getDate() + neededDays - 1)
    extendedEndsOn = extended.toISOString().slice(0, 10)
  }

  const scheduledAt: (string | null)[] = []
  const duration: (number | null)[] = []

  let dayIndex = 0
  let windowIndex = 0
  let inWindowSlot = 0 // which kickoff slot within the current window
  let inSlotCount = 0 // matches already placed in the current slot
  let placedToday = 0

  for (let i = 0; i < pairings.length; i++) {
    if (capacityPerDay && placedToday >= capacityPerDay) {
      dayIndex++; windowIndex = 0; inWindowSlot = 0; inSlotCount = 0; placedToday = 0
    }
    if (inSlotCount >= concurrency) {
      inSlotCount = 0
      inWindowSlot++
    }
    if (inWindowSlot >= slotsPerWindow[windowIndex]) {
      windowIndex++
      inWindowSlot = 0
      inSlotCount = 0
    }
    if (windowIndex >= windows.length) {
      dayIndex++; windowIndex = 0; inWindowSlot = 0; inSlotCount = 0; placedToday = 0
    }

    const window = windows[windowIndex]
    const day = new Date(`${startsOn}T00:00:00`)
    day.setDate(day.getDate() + dayIndex)
    const [sh, sm] = window.start.split(':').map(Number)
    day.setHours(sh, sm, 0, 0)
    day.setMinutes(day.getMinutes() + inWindowSlot * slotLen)

    scheduledAt.push(day.toISOString())
    duration.push(perMatch)
    inSlotCount++
    placedToday++
  }

  return { scheduledAt, duration, extendedEndsOn }
}

export async function generateFixtures(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const competitionId = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const { data: competition } = await ctx.db
    .from('competitions')
    .select('*')
    .eq('id', competitionId)
    .single()

  if (!competition) throw notFound('Competition not found')

  if (competition.status === 'live' || competition.status === 'completed') {
    throw badRequest('This competition is already underway — fixtures can only be regenerated before the first match starts')
  }

  const { data: teams } = await ctx.db
    .from('competition_teams')
    .select('id')
    .eq('competition_id', competitionId)
    .order('sort_order', { ascending: true })

  if (!teams || teams.length < 2) {
    throw badRequest('Draw at least two teams before generating fixtures')
  }

  const body = await ctx.body<Partial<FixtureSettings>>()
  validate(body as unknown as Record<string, unknown>, {
    match_duration_minutes: [int(1, 180)],
    matches_per_day: [int(1, 200)],
    concurrent_matches: [int(1, 20)],
    break_between_matches_minutes: [int(0, 120)],
    halftime_break_minutes: [int(0, 60)],
  })

  // Settings are remembered on the competition itself, so re-generating
  // (or a later "reschedule everything") reuses whatever was last set
  // without the organizer re-answering the same questions.
  const settingsPatch: Record<string, unknown> = {}
  if (body.match_duration_minutes !== undefined) settingsPatch.match_duration_minutes = body.match_duration_minutes
  if (body.day_starts_at !== undefined) settingsPatch.day_starts_at = body.day_starts_at
  if (body.day_ends_at !== undefined) settingsPatch.day_ends_at = body.day_ends_at
  if (body.evening_starts_at !== undefined) settingsPatch.evening_starts_at = body.evening_starts_at
  if (body.evening_ends_at !== undefined) settingsPatch.evening_ends_at = body.evening_ends_at
  if (body.matches_per_day !== undefined) settingsPatch.matches_per_day = body.matches_per_day
  if (body.concurrent_matches !== undefined) settingsPatch.concurrent_matches = body.concurrent_matches
  if (body.break_between_matches_minutes !== undefined) settingsPatch.break_between_matches_minutes = body.break_between_matches_minutes
  if (body.split_into_halves !== undefined) settingsPatch.split_into_halves = body.split_into_halves
  if (body.halftime_break_minutes !== undefined) settingsPatch.halftime_break_minutes = body.halftime_break_minutes

  const settings: FixtureSettings = {
    match_duration_minutes: body.match_duration_minutes ?? competition.match_duration_minutes ?? null,
    day_starts_at: body.day_starts_at ?? competition.day_starts_at ?? null,
    day_ends_at: body.day_ends_at ?? competition.day_ends_at ?? null,
    evening_starts_at: body.evening_starts_at ?? competition.evening_starts_at ?? null,
    evening_ends_at: body.evening_ends_at ?? competition.evening_ends_at ?? null,
    matches_per_day: body.matches_per_day ?? competition.matches_per_day ?? null,
    concurrent_matches: body.concurrent_matches ?? competition.concurrent_matches ?? 1,
    break_between_matches_minutes: body.break_between_matches_minutes ?? competition.break_between_matches_minutes ?? DEFAULT_BREAK_MINUTES,
    split_into_halves: body.split_into_halves ?? competition.split_into_halves ?? false,
    halftime_break_minutes: body.halftime_break_minutes ?? competition.halftime_break_minutes ?? null,
  }

  // Regenerating: this competition hasn't gone live (checked above), so no
  // fixture here can possibly have a real match attached yet — clear the
  // standing schedule and rebuild it fresh, the same soft-replace pattern
  // the team draft uses.
  const { data: existingRounds } = await ctx.db
    .from('competition_rounds')
    .select('id')
    .eq('competition_id', competitionId)
  if (existingRounds && existingRounds.length > 0) {
    await ctx.db.from('competition_rounds').delete().eq('competition_id', competitionId)
  }

  const { data: round, error: roundErr } = await ctx.db
    .from('competition_rounds')
    .insert({ organization_id: member.organizationId, competition_id: competitionId, kind: 'round_robin', sequence: 1 })
    .select('id')
    .single()
  if (roundErr) throw new Error(roundErr.message)

  const teamIds = teams.map((t) => t.id)
  let legs = circleMethod(teamIds)
  if (competition.double_round_robin) {
    const secondLeg = circleMethod(teamIds).map((r) => r.map((p) => ({ home: p.away, away: p.home })))
    legs = [...legs, ...secondLeg]
  }

  const allPairings = legs.flat()
  const { scheduledAt, duration, extendedEndsOn } = scheduleFixtures(
    allPairings,
    competition.starts_on,
    competition.ends_on,
    settings,
  )

  if (extendedEndsOn) settingsPatch.ends_on = extendedEndsOn

  const rows = allPairings.map((p, i) => ({
    organization_id: member.organizationId,
    competition_id: competitionId,
    competition_round_id: round.id,
    sequence: i + 1,
    home_team_id: p.home,
    away_team_id: p.away,
    scheduled_at: scheduledAt[i],
    duration_minutes: duration[i],
  }))

  const { data: fixtures, error: fixturesErr } = await ctx.db
    .from('competition_fixtures')
    .insert(rows)
    .select('*')
    .order('sequence', { ascending: true })

  if (fixturesErr) throw new Error(fixturesErr.message)

  settingsPatch.status = 'scheduled'
  await ctx.db.from('competitions').update(settingsPatch).eq('id', competitionId)

  return successResponse(
    fixtures,
    extendedEndsOn
      ? `${fixtures?.length ?? 0} fixture(s) generated — the competition now runs through ${extendedEndsOn} to fit them all in`
      : `${fixtures?.length ?? 0} fixture(s) generated`,
    {},
    201,
  )
}

export async function listFixtures(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const competitionId = ctx.segments[0]
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)

  const { data, error } = await ctx.db
    .from('competition_fixtures')
    .select(`
      *,
      home_team:competition_teams!competition_fixtures_home_team_id_fkey(id, name, short_name, color),
      away_team:competition_teams!competition_fixtures_away_team_id_fkey(id, name, short_name, color),
      matches!competition_fixtures_match_id_fkey(id, status, side_a_score, side_b_score, started_at, ended_at)
    `)
    .eq('competition_id', competitionId)
    .order('sequence', { ascending: true })

  if (error) throw new Error(error.message)
  return successResponse(data ?? [])
}

/** Reschedule (drag) or swap the teams on one fixture. */
export async function updateFixture(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const competitionId = ctx.segments[0]
  const fixtureId = ctx.segments[2] // ['id', 'fixtures', 'fixture_id']
  await assertOwned(ctx.db, 'competitions', competitionId, member.organizationId)
  await assertOwned(ctx.db, 'competition_fixtures', fixtureId, member.organizationId)

  const body = await ctx.body<{ scheduled_at?: string | null; duration_minutes?: number | null; home_team_id?: string; away_team_id?: string }>()
  validate(body as unknown as Record<string, unknown>, { home_team_id: [uuid], away_team_id: [uuid] })

  if (body.home_team_id && body.away_team_id && body.home_team_id === body.away_team_id) {
    throw badRequest('A team cannot play itself')
  }

  const patch: Record<string, unknown> = {}
  if (body.scheduled_at !== undefined) patch.scheduled_at = body.scheduled_at
  if (body.duration_minutes !== undefined) patch.duration_minutes = body.duration_minutes
  if (body.home_team_id !== undefined) patch.home_team_id = body.home_team_id
  if (body.away_team_id !== undefined) patch.away_team_id = body.away_team_id

  const { data, error } = await ctx.db
    .from('competition_fixtures')
    .update(patch)
    .eq('id', fixtureId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Fixture updated')
}
