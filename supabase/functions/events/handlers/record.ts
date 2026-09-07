/**
 * Recording match events. This is the hottest path in the product: an organizer
 * standing beside a pitch on patchy mobile data, tapping in a goal seconds
 * after it happens.
 *
 * Three things matter more here than anywhere else:
 *   1. Idempotency — the offline queue retries, and a retry must never
 *      double-count a goal. Every write carries a client_key.
 *   2. Atomicity of a goal+assist pair — they share a group_id so undoing one
 *      undoes both.
 *   3. Speed — one round trip, minimal work, recompute after responding is not
 *      possible in Deno Deploy so the recompute is kept to a scoped aggregate.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { int, isArray, oneOf, required, str, validate } from '../../_shared/validation.ts'
import {
  assertPeriodOpen,
  broadcast,
  editWindowOpen,
  recomputeStats,
  refreshMatchScore,
  touchSessionActivity,
} from '../../_shared/helpers.ts'

const EVENT_TYPES = [
  'goal', 'own_goal', 'assist', 'yellow_card', 'red_card',
  'clean_sheet', 'penalty_save', 'save', 'motm',
] as const

interface RecordBody {
  match_id: string
  event_type: typeof EVENT_TYPES[number]
  player_id: string
  /** For a goal, the assister. Omit or null for a solo goal. */
  related_player_id?: string | null
  minute?: number | null
  client_key?: string
  metadata?: Record<string, unknown>
}

interface MatchContext {
  id: string
  session_id: string | null
  period_id: string
  competition_id: string | null
  status: string
  session_ended_at: string | null
}

/**
 * A match is either session-born or competition-born (matches_session_or_
 * competition check). Resolve period_id and an edit-window anchor from
 * whichever side is present — competition matches have no session row, so
 * `matches.ended_at` (the match's own timestamp) stands in for
 * session.ended_at, and the period comes from the competition instead.
 */
async function loadMatch(ctx: Ctx, matchId: string, organizationId: string): Promise<MatchContext> {
  // Plain lookups, walked by hand rather than one query with nested embeds.
  // A goal in a session match must not depend on the database being able to
  // resolve a competition relationship it has nothing to do with — when that
  // resolution failed, every recorded goal came back as "Match not found",
  // which sent us looking for a missing match that was sitting right there.
  const { data, error } = await ctx.db
    .from('matches')
    .select('id, status, ended_at, session_id, competition_fixture_id')
    .eq('id', matchId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) throw new Error(`Could not load the match: ${error.message}`)
  if (!data) throw notFound('Match not found')

  let periodId: string | null = null
  let sessionEndedAt: string | null = null
  let competitionId: string | null = null

  if (data.session_id) {
    const { data: session, error: sessionError } = await ctx.db
      .from('sessions')
      .select('id, period_id, ended_at')
      .eq('id', data.session_id)
      .maybeSingle()
    if (sessionError) throw new Error(`Could not load the session: ${sessionError.message}`)
    periodId = session?.period_id ?? null
    sessionEndedAt = session?.ended_at ?? null
  } else if (data.competition_fixture_id) {
    const { data: fixture, error: fixtureError } = await ctx.db
      .from('competition_fixtures')
      .select('competition_id')
      .eq('id', data.competition_fixture_id)
      .maybeSingle()
    if (fixtureError) throw new Error(`Could not load the fixture: ${fixtureError.message}`)

    if (fixture?.competition_id) {
      competitionId = fixture.competition_id
      const { data: competition, error: competitionError } = await ctx.db
        .from('competitions')
        .select('period_id')
        .eq('id', fixture.competition_id)
        .maybeSingle()
      if (competitionError) throw new Error(`Could not load the competition: ${competitionError.message}`)
      periodId = competition?.period_id ?? null
    }
  }

  if (!periodId) throw notFound('Match has no session or competition to record against')

  return {
    id: data.id,
    session_id: data.session_id ?? null,
    period_id: periodId,
    competition_id: competitionId,
    status: data.status,
    // A competition match has no session, so its own end time is the anchor
    // for the edit window.
    session_ended_at: sessionEndedAt ?? (data.ended_at as string | null),
  }
}

/** Which side is this player on? Needed to attribute the goal to a scoreline. */
async function sideOf(ctx: Ctx, matchId: string, playerId: string): Promise<'a' | 'b' | null> {
  const { data, error } = await ctx.db
    .from('match_players')
    .select('side')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (error) throw new Error(`Could not check the squad: ${error.message}`)
  return (data?.side as 'a' | 'b') ?? null
}

export async function recordEvent(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const body = await ctx.body<RecordBody>()

  validate(body as unknown as Record<string, unknown>, {
    match_id: [required, str(36, 36)],
    event_type: [required, oneOf(EVENT_TYPES)],
    player_id: [required, str(36, 36)],
    minute: [int(0, 200)],
    client_key: [str(0, 100)],
  })

  const match = await loadMatch(ctx, body.match_id, member.organizationId)
  await assertPeriodOpen(ctx.db, match.period_id)

  if (match.status === 'abandoned') {
    throw badRequest('That match was abandoned')
  }
  if (!editWindowOpen(match.status, match.session_ended_at)) {
    throw badRequest('The 5-hour window to edit this session has closed')
  }

  const side = await sideOf(ctx, body.match_id, body.player_id)
  if (!side) {
    throw badRequest('That player is not in this match')
  }

  // Clean sheets stack on purpose. A session is played as a run of short sets
  // with sides re-forming and the keeper rotating between them; keep five sets
  // clean and that is five clean sheets. The app does not model sets at all,
  // and the whole session is one `matches` row, so the only honest reading of
  // a second tap is a second clean sheet — never a duplicate to swallow.
  // Nothing derives them from the scoreline, so nothing overwrites them
  // either. Offline-queue idempotency is unaffected: that is client_key's
  // job, and a genuine retry carries the same one.
  const now = new Date().toISOString()
  const groupId = crypto.randomUUID()
  const isAssistedGoal = body.event_type === 'goal' && !!body.related_player_id

  const rows: Record<string, unknown>[] = [
    {
      organization_id: member.organizationId,
      match_id: match.id,
      session_id: match.session_id,
      period_id: match.period_id,
      competition_id: match.competition_id,
      player_id: body.player_id,
      related_player_id: body.related_player_id ?? null,
      event_type: body.event_type,
      side,
      minute: body.minute ?? null,
      metadata: {
        ...(body.metadata ?? {}),
        group_id: groupId,
        ...(body.event_type === 'clean_sheet' ? { manual: true } : {}),
      },
      client_key: body.client_key ?? null,
      created_by: member.user.id,
      created_at: now,
    },
  ]

  // An assisted goal writes two rows. The redundancy is deliberate: it makes
  // every statistic an identical COUNT, so the scoring engine has no special
  // cases and the two counts can never drift apart.
  if (isAssistedGoal) {
    const assisterSide = await sideOf(ctx, body.match_id, body.related_player_id!)
    if (!assisterSide) {
      throw badRequest('The assisting player is not in this match')
    }
    rows.push({
      organization_id: member.organizationId,
      match_id: match.id,
      session_id: match.session_id,
      period_id: match.period_id,
      competition_id: match.competition_id,
      player_id: body.related_player_id,
      related_player_id: body.player_id,
      event_type: 'assist',
      side: assisterSide,
      minute: body.minute ?? null,
      metadata: { group_id: groupId },
      client_key: body.client_key ? `${body.client_key}:assist` : null,
      created_by: member.user.id,
      created_at: now,
    })
  }

  const { data, error } = await ctx.db
    .from('match_events')
    .upsert(rows, { onConflict: 'match_id,client_key', ignoreDuplicates: true })
    .select('*')

  if (error) throw new Error(error.message)

  // A retry that hit the idempotency guard is a success, not a failure — the
  // event is already recorded and the phone just did not hear us say so.
  if (!data || data.length === 0) {
    return successResponse({ duplicate: true, group_id: groupId }, 'Already recorded')
  }

  if (body.event_type === 'goal' || body.event_type === 'own_goal') {
    await refreshMatchScore(ctx.db, match.id)
  }
  await recomputeStats(ctx.db, match.period_id)
  if (match.session_id) await touchSessionActivity(ctx.db, match.session_id)
  await broadcast(ctx.db, member.organizationId, match.period_id, 'event.recorded', {
    match_id: match.id,
    event_type: body.event_type,
    player_id: body.player_id,
  })

  const { data: score } = await ctx.db
    .from('matches')
    .select('side_a_score, side_b_score')
    .eq('id', match.id)
    .single()

  return successResponse(
    { events: data, group_id: groupId, score },
    'Recorded',
    {},
    201,
  )
}

/**
 * Batch write — the offline queue flushing after signal comes back.
 * Each entry keeps its own client_key, so a partial earlier flush is safe.
 */
export async function recordBatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const body = await ctx.body<{ events: RecordBody[] }>()

  validate(body as unknown as Record<string, unknown>, {
    events: [required, isArray(1, 100)],
  })

  const results: { client_key?: string; ok: boolean; error?: string }[] = []
  const touchedMatches = new Set<string>()
  const touchedPeriods = new Set<string>()

  for (const entry of body.events) {
    try {
      const match = await loadMatch(ctx, entry.match_id, member.organizationId)
      const side = await sideOf(ctx, entry.match_id, entry.player_id)
      if (!side) throw new Error('Player not in this match')

      const groupId = crypto.randomUUID()
      const rows: Record<string, unknown>[] = [{
        organization_id: member.organizationId,
        match_id: match.id,
        session_id: match.session_id,
        period_id: match.period_id,
        competition_id: match.competition_id,
        player_id: entry.player_id,
        related_player_id: entry.related_player_id ?? null,
        event_type: entry.event_type,
        side,
        minute: entry.minute ?? null,
        metadata: {
          group_id: groupId,
          queued: true,
          ...(entry.event_type === 'clean_sheet' ? { manual: true } : {}),
        },
        client_key: entry.client_key ?? null,
        created_by: member.user.id,
      }]

      if (entry.event_type === 'goal' && entry.related_player_id) {
        const assisterSide = await sideOf(ctx, entry.match_id, entry.related_player_id)
        if (assisterSide) {
          rows.push({
            organization_id: member.organizationId,
            match_id: match.id,
            session_id: match.session_id,
            period_id: match.period_id,
            competition_id: match.competition_id,
            player_id: entry.related_player_id,
            related_player_id: entry.player_id,
            event_type: 'assist',
            side: assisterSide,
            minute: entry.minute ?? null,
            metadata: { group_id: groupId, queued: true },
            client_key: entry.client_key ? `${entry.client_key}:assist` : null,
            created_by: member.user.id,
          })
        }
      }

      const { error } = await ctx.db
        .from('match_events')
        .upsert(rows, { onConflict: 'match_id,client_key', ignoreDuplicates: true })

      if (error) throw new Error(error.message)

      touchedMatches.add(match.id)
      touchedPeriods.add(match.period_id)
      results.push({ client_key: entry.client_key, ok: true })
    } catch (err) {
      // One bad entry must not discard the rest of the queue.
      results.push({
        client_key: entry.client_key,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const id of touchedMatches) await refreshMatchScore(ctx.db, id)
  for (const id of touchedPeriods) await recomputeStats(ctx.db, id)

  const succeeded = results.filter((r) => r.ok).length
  return successResponse(results, `${succeeded} of ${results.length} synced`, {
    synced: succeeded,
    failed: results.length - succeeded,
  })
}

/**
 * Undo. Sets voided_at rather than deleting, so the audit trail survives the
 * inevitable argument about whether that goal actually counted.
 *
 * Cascade is one-directional: voiding a GOAL takes its assist with it (an
 * assist can never outlive the goal it belongs to), but voiding just the
 * assist leaves the goal standing as a solo goal — the goal doesn't depend
 * on the assist. Any other event type (card, own goal) only ever voids
 * itself; it has no paired row to cascade to.
 */
export async function voidEvent(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const eventId = ctx.segments[0]

  const { data: event } = await ctx.db
    .from('match_events')
    .select('id, match_id, session_id, period_id, metadata, event_type, matches(status, sessions(ended_at))')
    .eq('id', eventId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!event) throw notFound('That event was not found')
  await assertPeriodOpen(ctx.db, event.period_id)

  const match = event.matches as unknown as { status: string; sessions: { ended_at: string | null } }
  if (!editWindowOpen(match.status, match.sessions?.ended_at ?? null)) {
    throw badRequest('The 5-hour window to edit this session has closed')
  }

  const groupId = (event.metadata as Record<string, unknown> | null)?.group_id as string | undefined
  const voidPatch = { voided_at: new Date().toISOString(), voided_by: member.user.id }

  if (groupId && event.event_type === 'goal') {
    await ctx.db
      .from('match_events')
      .update(voidPatch)
      .eq('organization_id', member.organizationId)
      .filter('metadata->>group_id', 'eq', groupId)
      .is('voided_at', null)
  } else {
    await ctx.db.from('match_events').update(voidPatch).eq('id', eventId)
  }

  await refreshMatchScore(ctx.db, event.match_id)
  await recomputeStats(ctx.db, event.period_id)
  await touchSessionActivity(ctx.db, event.session_id)
  await broadcast(ctx.db, member.organizationId, event.period_id, 'event.voided', {
    match_id: event.match_id,
  })

  return successResponse({ id: eventId }, 'Undone')
}

/**
 * Correct an already-recorded event: reassign who scored/assisted, or fix
 * the minute. Only usable live or within the post-session edit window —
 * same rule as recording and voiding. Every change is logged to
 * match_event_edits (who, when, old value → new value), so a corrected
 * record is visibly different from one nobody ever touched.
 *
 * An assist cannot exist on its own — it's always the credit for a specific
 * goal. So editing a GOAL's `related_player_id` here is how you assign,
 * change, or remove that goal's assist: it manages the paired `assist`
 * match_events row (insert/update/void) directly, rather than the caller
 * ever addressing the assist row itself.
 */
export async function updateEvent(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const eventId = ctx.segments[0]
  const body = await ctx.body<{ player_id?: string; related_player_id?: string | null; minute?: number | null }>()

  validate(body as unknown as Record<string, unknown>, {
    player_id: [str(36, 36)],
    minute: [int(0, 200)],
  })

  const { data: event } = await ctx.db
    .from('match_events')
    .select('*, matches(id, status, sessions(ended_at))')
    .eq('id', eventId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!event) throw notFound('That event was not found')
  if (event.voided_at) throw badRequest('That event was undone — nothing to correct')
  await assertPeriodOpen(ctx.db, event.period_id)

  const match = event.matches as unknown as { id: string; status: string; sessions: { ended_at: string | null } }
  if (!editWindowOpen(match.status, match.sessions?.ended_at ?? null)) {
    throw badRequest('The 5-hour window to edit this session has closed')
  }

  const now = new Date().toISOString()
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const patch: Record<string, unknown> = {}
  const newScorerId = body.player_id ?? event.player_id

  if (body.player_id !== undefined && body.player_id !== event.player_id) {
    const side = await sideOf(ctx, event.match_id, body.player_id)
    if (!side) throw badRequest('That player is not in this match')
    changes.player_id = { from: event.player_id, to: body.player_id }
    patch.player_id = body.player_id
    patch.side = side
  }

  const groupId = (event.metadata as Record<string, unknown> | null)?.group_id as string | undefined

  if (event.event_type === 'goal' && groupId) {
    const { data: existingAssist } = await ctx.db
      .from('match_events')
      .select('id, player_id')
      .eq('match_id', event.match_id)
      .eq('event_type', 'assist')
      .filter('metadata->>group_id', 'eq', groupId)
      .is('voided_at', null)
      .maybeSingle()

    if (body.related_player_id !== undefined) {
      const intendedAssisterId = body.related_player_id

      if (intendedAssisterId !== event.related_player_id) {
        changes.related_player_id = { from: event.related_player_id, to: intendedAssisterId }
        patch.related_player_id = intendedAssisterId
      }

      if (!intendedAssisterId && existingAssist) {
        // Clearing the assist — the goal stands alone from here.
        await ctx.db
          .from('match_events')
          .update({ voided_at: now, voided_by: member.user.id })
          .eq('id', existingAssist.id)
      } else if (intendedAssisterId && !existingAssist) {
        // This goal had no assist — assigning one for the first time.
        const assisterSide = await sideOf(ctx, event.match_id, intendedAssisterId)
        if (!assisterSide) throw badRequest('That player is not in this match')
        await ctx.db.from('match_events').insert({
          organization_id: member.organizationId,
          match_id: event.match_id,
          session_id: event.session_id,
          period_id: event.period_id,
          player_id: intendedAssisterId,
          related_player_id: newScorerId,
          event_type: 'assist',
          side: assisterSide,
          minute: body.minute ?? event.minute,
          metadata: { group_id: groupId },
          created_by: member.user.id,
          created_at: now,
          edited_at: now,
          edited_by: member.user.id,
        })
      } else if (intendedAssisterId && existingAssist && intendedAssisterId !== existingAssist.player_id) {
        // Reassigning credit for the existing assist to someone else.
        const assisterSide = await sideOf(ctx, event.match_id, intendedAssisterId)
        if (!assisterSide) throw badRequest('That player is not in this match')
        await ctx.db
          .from('match_events')
          .update({
            player_id: intendedAssisterId,
            related_player_id: newScorerId,
            side: assisterSide,
            edited_at: now,
            edited_by: member.user.id,
          })
          .eq('id', existingAssist.id)
      } else if (existingAssist && newScorerId !== event.player_id) {
        // Same assister, but the scorer changed — keep the assist's
        // "assisted whom" pointer from going stale.
        await ctx.db
          .from('match_events')
          .update({ related_player_id: newScorerId })
          .eq('id', existingAssist.id)
      }
    } else if (existingAssist && newScorerId !== event.player_id) {
      // Assist untouched, but the scorer changed underneath it.
      await ctx.db
        .from('match_events')
        .update({ related_player_id: newScorerId })
        .eq('id', existingAssist.id)
    }
  }

  if (body.minute !== undefined && body.minute !== event.minute) {
    changes.minute = { from: event.minute, to: body.minute }
    patch.minute = body.minute
  }

  if (Object.keys(patch).length === 0) {
    return successResponse(event, 'Nothing to change')
  }

  const { data: updated, error } = await ctx.db
    .from('match_events')
    .update({ ...patch, edited_at: now, edited_by: member.user.id })
    .eq('id', eventId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  if (Object.keys(changes).length > 0) {
    await ctx.db.from('match_event_edits').insert({
      organization_id: member.organizationId,
      event_id: eventId,
      edited_by: member.user.id,
      edited_at: now,
      changes,
    })
  }

  if (event.event_type === 'goal' || event.event_type === 'own_goal') {
    await refreshMatchScore(ctx.db, event.match_id)
  }
  await recomputeStats(ctx.db, event.period_id)
  await touchSessionActivity(ctx.db, event.session_id)

  return successResponse(updated, 'Corrected')
}

/** The timeline for a match, newest last. */
export async function listEvents(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const matchId = ctx.query.get('match_id')
  const sessionId = ctx.query.get('session_id')

  if (!matchId && !sessionId) {
    throw badRequest('Specify either match_id or session_id')
  }

  let q = ctx.db
    .from('match_events')
    .select('*, players!match_events_player_id_fkey(display_name, whatsapp_nickname, jersey_number, photo_url)')
    .eq('organization_id', member.organizationId)
    .is('voided_at', null)

  if (matchId) q = q.eq('match_id', matchId)
  if (sessionId) q = q.eq('session_id', sessionId)

  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  return successResponse(data ?? [], 'Events')
}
