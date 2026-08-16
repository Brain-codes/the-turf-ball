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

/** A readable name when the organizer hasn't given one: "Sunday 5:00 PM". */
function autoLabel(weekday: number, kickoff: string): string {
  const [h, m] = kickoff.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${DAY_NAMES[weekday]} ${hour12}:${String(m).padStart(2, '0')} ${period}`
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

  const { data, error } = await ctx.db
    .from('session_slots')
    .insert({
      organization_id: member.organizationId,
      label: body.label ? String(body.label).trim() : null,
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

  return successResponse(
    { ...data, display_label: data.label || autoLabel(data.weekday, data.kickoff) },
    'Schedule updated',
  )
}

/**
 * Remove a slot. Sessions already played under it keep their history — the
 * foreign key nulls out rather than cascading, so deleting "Tuesday Evening"
 * never deletes the goals scored on a Tuesday.
 */
export async function deleteSlot(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin', ctx.segments[0])
  const slotId = ctx.segments[2]

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
