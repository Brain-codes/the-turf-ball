/**
 * Session slots — the group's recurring schedule.
 *
 * A slot is one repeating fixture: a weekday, a kick-off time, and optionally a
 * name and its own venue. A group can have as many as it likes, including two
 * on the same day (a Sunday morning and a Sunday evening are separate slots).
 *
 * These live under /organizations because they belong to the organization
 * resource, not a resource of their own — rule2.txt §3.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { badRequest, conflict, notFound } from '../../_shared/errors.ts'
import { bool, int, required, str, validate } from '../../_shared/validation.ts'
import { audit } from '../../_shared/helpers.ts'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** '7:00' / '07:00' / '07:00:00' all mean the same thing. Normalise. */
function normaliseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

/** A readable name when the organizer hasn't given one: "Evening Sunday Session". */
function autoLabel(weekday: number, kickoff: string): string {
  const [h] = kickoff.split(':').map(Number)
  const timeOfDay = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
  return `${timeOfDay} ${DAY_NAMES[weekday]} Session`
}

export async function listSlots(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'recorder', ctx.segments[0])

  const { data, error } = await ctx.db
    .from('session_slots')
    .select('*')
    .eq('organization_id', member.organizationId)
    .order('weekday', { ascending: true })
    .order('kickoff', { ascending: true })

  if (error) throw new Error(error.message)

  const slots = (data ?? []).map((slot: Record<string, unknown>) => ({
    ...slot,
    display_label: slot.label || autoLabel(slot.weekday as number, String(slot.kickoff)),
    day_name: DAY_NAMES[slot.weekday as number],
  }))

  return successResponse(slots, 'Your schedule', { total: slots.length })
}

/** The next few real dates these slots fall on, so booking is one tap. */
export async function upcomingSlots(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'recorder', ctx.segments[0])
  const limit = Math.min(20, Number(ctx.query.get('limit') ?? 8) || 8)

  const { data, error } = await ctx.db.rpc('upcoming_slots', {
    p_org: member.organizationId,
    p_limit: limit,
  })

  if (error) throw new Error(error.message)

  const upcoming = (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    display_label: row.label || autoLabel(row.weekday as number, String(row.kickoff)),
    day_name: DAY_NAMES[row.weekday as number],
  }))

  return successResponse(upcoming, 'Coming up')
}

export async function createSlot(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin', ctx.segments[0])
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    weekday: [required, int(0, 6)],
    kickoff: [required, str(4, 8)],
    label: [str(0, 40)],
    venue: [str(0, 120)],
    duration_minutes: [int(15, 480)],
  })

  const kickoff = normaliseTime(body.kickoff)
  if (!kickoff) throw badRequest('That kick-off time is not valid')

  // A name is always stored, even when the organizer doesn't type one — so
  // it shows up immediately in Settings > Schedule instead of "No name",
  // and can still be renamed later like any other slot.
  const label = body.label ? String(body.label).trim() : autoLabel(Number(body.weekday), kickoff)

  const { data, error } = await ctx.db
    .from('session_slots')
    .insert({
      organization_id: member.organizationId,
      label,
      weekday: Number(body.weekday),
      kickoff,
      venue: body.venue ? String(body.venue).trim() : null,
      duration_minutes: body.duration_minutes ?? 90,
      sort_order: Number(body.weekday) * 100,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw conflict('You already have a session at that day and time')
    }
    throw new Error(error.message)
  }

  await audit(ctx.db, member.organizationId, member.user.id, 'slot.create', 'session_slot', data.id)

  // Materialize immediately rather than waiting for the next 15-minute cron
  // tick — the organizer expects to see the real session the moment they add
  // a slot, not up to 15 minutes later. Runs the same tested job used by the
  // schedule; best-effort, since a materialization hiccup shouldn't block
  // the slot itself from being saved (the cron job will catch it regardless).
  const { error: materializeError } = await ctx.db.rpc('materialize_and_flag_sessions')
  if (materializeError) {
    ctx.log.error('materialize_and_flag_sessions failed after slot create', { error: materializeError.message })
  }

  return successResponse(
    { ...data, display_label: data.label || autoLabel(data.weekday, data.kickoff) },
    `${data.label || autoLabel(data.weekday, data.kickoff)} added`,
    {},
    201,
  )
}

export async function updateSlot(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin', ctx.segments[0])
  const slotId = ctx.segments[2]
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    weekday: [int(0, 6)],
    label: [str(0, 40)],
    venue: [str(0, 120)],
    duration_minutes: [int(15, 480)],
    is_active: [bool],
  })

  const patch: Record<string, unknown> = {}
  if (body.label !== undefined) patch.label = body.label ? String(body.label).trim() : null
  if (body.venue !== undefined) patch.venue = body.venue ? String(body.venue).trim() : null
  if (body.weekday !== undefined) patch.weekday = Number(body.weekday)
  if (body.duration_minutes !== undefined) patch.duration_minutes = body.duration_minutes
  if (body.is_active !== undefined) patch.is_active = body.is_active

  if (body.kickoff !== undefined) {
    const kickoff = normaliseTime(body.kickoff)
    if (!kickoff) throw badRequest('That kick-off time is not valid')
    patch.kickoff = kickoff
  }

  const { data, error } = await ctx.db
    .from('session_slots')
    .update(patch)
    .eq('id', slotId)
    .eq('organization_id', member.organizationId)
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      throw conflict('You already have a session at that day and time')
    }
    throw new Error(error.message)
  }
  if (!data) throw notFound('That session time was not found')

  // Sessions already materialized from this slot are frozen copies of its
  // old day/time/name/venue — changing the slot doesn't retroactively touch
  // them. Drop the ones nothing has happened on yet (still 'scheduled') and
  // let the materializer regenerate them fresh from the updated slot, same
  // as it would on its next 15-minute tick, just instant. History-bearing
  // sessions (live/completed) are untouched, exactly like on delete.
  const { error: pruneError } = await ctx.db
    .from('sessions')
    .delete()
    .eq('slot_id', slotId)
    .eq('organization_id', member.organizationId)
    .eq('status', 'scheduled')

  if (pruneError) throw new Error(pruneError.message)

  const { error: materializeError } = await ctx.db.rpc('materialize_and_flag_sessions')
  if (materializeError) {
    ctx.log.error('materialize_and_flag_sessions failed after slot update', { error: materializeError.message })
  }

  return successResponse(
    { ...data, display_label: data.label || autoLabel(data.weekday, data.kickoff) },
    'Schedule updated',
  )
}

/**
 * Remove a slot. Sessions already played under it keep their history — the
 * foreign key nulls out rather than cascading, so deleting "Tuesday Evening"
 * never deletes the goals scored on a Tuesday.
 *
 * But a session that's still just `scheduled` (materialized in advance by
 * the auto-session job, kickoff hasn't happened yet) isn't history — it's a
 * future promise the organizer just withdrew, with nothing recorded against
 * it yet. Deleted outright rather than merely cancelled, so it disappears
 * from /app/sessions entirely instead of lingering as a dead entry. Cascade
 * (session_attendance, matches) is safe here precisely because nothing real
 * has happened on it — a session with any recorded activity would already
 * have moved past 'scheduled'.
 */
export async function deleteSlot(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin', ctx.segments[0])
  const slotId = ctx.segments[2]

  const { error: pruneError } = await ctx.db
    .from('sessions')
    .delete()
    .eq('slot_id', slotId)
    .eq('organization_id', member.organizationId)
    .eq('status', 'scheduled')

  if (pruneError) throw new Error(pruneError.message)

  const { data, error } = await ctx.db
    .from('session_slots')
    .delete()
    .eq('id', slotId)
    .eq('organization_id', member.organizationId)
    .select('id, label, weekday, kickoff')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw notFound('That session time was not found')

  await audit(ctx.db, member.organizationId, member.user.id, 'slot.delete', 'session_slot', slotId)

  return successResponse(
    { id: slotId },
    `${data.label || autoLabel(data.weekday, data.kickoff)} removed`,
  )
}
