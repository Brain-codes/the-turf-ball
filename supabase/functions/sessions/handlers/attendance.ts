/**
 * Attendance and punctuality.
 *
 * The organizer is standing at the pitch ticking off names, so this accepts a
 * whole batch in one call rather than one request per player — twenty-four
 * round-trips on patchy mobile data is not a workable interaction.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { isArray, required, validate } from '../../_shared/validation.ts'
import { bandArrival, orgSettings, recomputeStats, touchSessionActivity } from '../../_shared/helpers.ts'

interface Entry {
  player_id: string
  status?: 'present' | 'absent' | 'excused'
  arrived_at?: string | null
}

export async function setAttendance(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  const body = await ctx.body<{ entries: Entry[] }>()
  validate(body as unknown as Record<string, unknown>, {
    entries: [required, isArray(1, 200)],
  })

  const { data: session } = await ctx.db
    .from('sessions')
    .select('id, kickoff_at, actual_kickoff_at, period_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) throw notFound('Session not found')

  const settings = await orgSettings(ctx.db, member.organizationId)
  // Punctuality is judged against when the session actually kicked off, not
  // the scheduled time — a group that starts 30 minutes late shouldn't make
  // everyone who showed up on time "late". Falls back to the scheduled time
  // before the session has actually started (nobody can be marked present
  // before that anyway).
  const kickoff = new Date(session.actual_kickoff_at ?? session.kickoff_at)

  const rows = body.entries.map((entry) => {
    const status = entry.status ?? 'present'
    let band: string | null = null
    let points = 0

    // Punctuality only applies to people who actually turned up, and only if
    // the group tracks it.
    if (status === 'present' && settings.track_punctuality) {
      // Default arrival to now: the organizer is ticking people off as they
      // walk in, so "now" is almost always the right answer.
      const arrived = entry.arrived_at ? new Date(entry.arrived_at) : new Date()
      if (!Number.isNaN(arrived.getTime())) {
        const result = bandArrival(arrived, kickoff, settings)
        band = result.band
        points = result.points
      }
    }

    return {
      organization_id: member.organizationId,
      session_id: sessionId,
      player_id: entry.player_id,
      status,
      arrived_at: status === 'present' ? (entry.arrived_at ?? new Date().toISOString()) : null,
      punctuality_band: band,
      punctuality_points: points,
    }
  })

  const { data, error } = await ctx.db
    .from('session_attendance')
    .upsert(rows, { onConflict: 'session_id,player_id' })
    .select('*, players(id, display_name, whatsapp_nickname, photo_url, jersey_number, position)')

  if (error) throw new Error(error.message)

  // Punctuality feeds the leaderboard, so the table must move immediately.
  await recomputeStats(ctx.db, session.period_id)
  await touchSessionActivity(ctx.db, sessionId)

  const present = rows.filter((r) => r.status === 'present').length
  return successResponse(data ?? [], `${present} player(s) marked in`)
}

/**
 * Mark a session live — the point at which match-day mode takes over.
 *
 * Everyone marked present during the "who's here?" screen tapped in before
 * this moment, so once the real kick-off time is known, their punctuality
 * bands (computed against the scheduled time, since actual_kickoff_at didn't
 * exist yet) are recalculated against it — that's what makes "anyone present
 * when the session actually starts is early, not late" true regardless of
 * how late the group itself got going.
 */
export async function startSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  const { data: existing } = await ctx.db
    .from('sessions')
    .select('id, kickoff_at, actual_kickoff_at, period_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!existing) throw notFound('Session not found')

  // Idempotent — resuming an already-started session (e.g. after full time)
  // must not overwrite the real kick-off moment with "now".
  const actualKickoff = existing.actual_kickoff_at ?? new Date().toISOString()

  const { data, error } = await ctx.db
    .from('sessions')
    .update({ status: 'live', actual_kickoff_at: actualKickoff })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  if (!existing.actual_kickoff_at) {
    const settings = await orgSettings(ctx.db, member.organizationId)
    if (settings.track_punctuality) {
      const { data: present } = await ctx.db
        .from('session_attendance')
        .select('id, arrived_at')
        .eq('session_id', sessionId)
        .eq('status', 'present')

      for (const row of present ?? []) {
        if (!row.arrived_at) continue
        const arrived = new Date(row.arrived_at)
        if (Number.isNaN(arrived.getTime())) continue
        const { band, points } = bandArrival(arrived, new Date(actualKickoff), settings)
        await ctx.db
          .from('session_attendance')
          .update({ punctuality_band: band, punctuality_points: points })
          .eq('id', row.id)
      }

      await recomputeStats(ctx.db, existing.period_id)
    }
  }

  return successResponse(data, 'Session started')
}

/**
 * The organizer answered "yes, still going" to the quiet-session prompt.
 * Clears the flag and resets the activity clock so the scheduler leaves it
 * alone for another 15 minutes before checking again.
 */
export async function keepAlive(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  const now = new Date().toISOString()
  const { data, error } = await ctx.db
    .from('sessions')
    .update({ awaiting_confirmation: false, last_activity_at: now, last_viewed_at: now })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Still going')
}

/** Wrap up: close any unfinished matches, then recompute the month. */
export async function completeSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const sessionId = ctx.segments[0]
  await assertOwned(ctx.db, 'sessions', sessionId, member.organizationId)

  await ctx.db
    .from('matches')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .in('status', ['pending', 'live'])

  const { data, error } = await ctx.db
    .from('sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString(), awaiting_confirmation: false })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  await recomputeStats(ctx.db, data.period_id)

  // The day's summary, for the wrap-up screen.
  const { data: events } = await ctx.db
    .from('match_events')
    .select('event_type, player_id, players(display_name, whatsapp_nickname)')
    .eq('session_id', sessionId)
    .is('voided_at', null)

  const tally = new Map<string, { name: string; goals: number; assists: number }>()
  for (const e of events ?? []) {
    const name = (e.players as { display_name?: string } | null)?.display_name ?? 'Unknown'
    const entry = tally.get(String(e.player_id)) ?? { name, goals: 0, assists: 0 }
    if (e.event_type === 'goal') entry.goals++
    if (e.event_type === 'assist') entry.assists++
    tally.set(String(e.player_id), entry)
  }

  const top = Array.from(tally.values())
    .sort((a, b) => b.goals * 2 + b.assists - (a.goals * 2 + a.assists))
    .slice(0, 3)

  return successResponse(
    {
      ...data,
      summary: {
        goals: (events ?? []).filter((e) => e.event_type === 'goal').length,
        assists: (events ?? []).filter((e) => e.event_type === 'assist').length,
        top_performers: top,
      },
    },
    'Session complete',
  )
}
