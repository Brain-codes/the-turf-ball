import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { required, str, validate } from '../../_shared/validation.ts'
import { badRequest } from '../../_shared/errors.ts'
import { assertPeriodOpen, periodForDate } from '../../_shared/helpers.ts'

export async function createSession(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    kickoff_at: [required, str(10, 40)],
    title: [str(0, 80)],
    venue: [str(0, 120)],
    slot_id: [str(36, 36)],
  })

  const kickoff = new Date(String(body.kickoff_at))
  if (Number.isNaN(kickoff.getTime())) {
    throw badRequest('That kick-off time is not valid')
  }

  // A session belongs to the month it is PLAYED in, worked out from its own
  // kick-off — not from whichever month happens to be open when someone
  // presses "create". Booking on 28 August for 2 September files it under
  // September, and any finished months in between close themselves on the way.
  const sessionDate = kickoff.toISOString().slice(0, 10)
  const periodId = await periodForDate(ctx.db, member.organizationId, sessionDate)
  await assertPeriodOpen(ctx.db, periodId)

  const { data: org } = await ctx.db
    .from('organizations')
    .select('venue')
    .eq('id', member.organizationId)
    .maybeSingle()

  // A session booked from a recurring slot inherits its name and venue, so the
  // organizer isn't retyping "Sunday Evening" every week.
  let slot: { id: string; label: string | null; venue: string | null } | null = null
  if (body.slot_id) {
    const { data } = await ctx.db
      .from('session_slots')
      .select('id, label, venue')
      .eq('id', String(body.slot_id))
      .eq('organization_id', member.organizationId)
      .maybeSingle()
    slot = data
  }

  // Best-effort expected end time, used for overtime tracking and the
  // "gone quiet past its end time" scheduler check — 90 minutes when there's
  // no slot to read a real duration from, same default the scheduler uses.
  let durationMinutes = 90
  if (slot) {
    const { data: slotRow } = await ctx.db
      .from('session_slots')
      .select('duration_minutes')
      .eq('id', slot.id)
      .maybeSingle()
    durationMinutes = slotRow?.duration_minutes ?? 90
  }
  const scheduledEndAt = new Date(kickoff.getTime() + durationMinutes * 60_000)

  const { data, error } = await ctx.db
    .from('sessions')
    .insert({
      organization_id: member.organizationId,
      period_id: periodId,
      title: body.title ? String(body.title).trim() : (slot?.label ?? null),
      session_date: kickoff.toISOString().slice(0, 10),
      kickoff_at: kickoff.toISOString(),
      scheduled_end_at: scheduledEndAt.toISOString(),
      venue: (body.venue as string) || slot?.venue || org?.venue || null,
      slot_id: slot?.id ?? null,
      status: 'scheduled',
      created_by: member.user.id,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Session created', {}, 201)
}
