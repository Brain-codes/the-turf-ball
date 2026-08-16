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
  recomputeStats,
  refreshMatchScore,
} from '../../_shared/helpers.ts'

const EVENT_TYPES = [
  'goal', 'own_goal', 'assist', 'yellow_card', 'red_card',
  'clean_sheet', 'save', 'motm',
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
  session_id: string
  period_id: string
  status: string
}

async function loadMatch(ctx: Ctx, matchId: string, organizationId: string): Promise<MatchContext> {
  const { data } = await ctx.db
    .from('matches')
    .select('id, status, sessions(id, period_id)')
    .eq('id', matchId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!data) throw notFound('Match not found')
  const session = data.sessions as unknown as { id: string; period_id: string }

  return {
    id: data.id,
    session_id: session.id,
    period_id: session.period_id,
    status: data.status,
  }
}

/** Which side is this player on? Needed to attribute the goal to a scoreline. */
async function sideOf(ctx: Ctx, matchId: string, playerId: string): Promise<'a' | 'b' | null> {
  const { data } = await ctx.db
    .from('match_players')
    .select('side')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .maybeSingle()
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

  if (match.status === 'completed' || match.status === 'abandoned') {
    throw badRequest('That match has already finished')
  }

  const side = await sideOf(ctx, body.match_id, body.player_id)
  if (!side) {
    throw badRequest('That player is not in this match')
  }

  const now = new Date().toISOString()
  const groupId = crypto.randomUUID()
  const isAssistedGoal = body.event_type === 'goal' && !!body.related_player_id

  const rows: Record<string, unknown>[] = [
    {
      organization_id: member.organizationId,
      match_id: match.id,
      session_id: match.session_id,
      period_id: match.period_id,
      player_id: body.player_id,
      related_player_id: body.related_player_id ?? null,
      event_type: body.event_type,
      side,
      minute: body.minute ?? null,
      metadata: { ...(body.metadata ?? {}), group_id: groupId },
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
        player_id: entry.player_id,
        related_player_id: entry.related_player_id ?? null,
        event_type: entry.event_type,
        side,
        minute: entry.minute ?? null,
        metadata: { group_id: groupId, queued: true },
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
 * inevitable argument about whether that goal actually counted. An assisted
 * goal voids its assist too, via the shared group_id.
 */
export async function voidEvent(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const eventId = ctx.segments[0]

  const { data: event } = await ctx.db
    .from('match_events')
    .select('id, match_id, period_id, metadata, event_type')
    .eq('id', eventId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!event) throw notFound('That event was not found')
  await assertPeriodOpen(ctx.db, event.period_id)

  const groupId = (event.metadata as Record<string, unknown> | null)?.group_id as string | undefined
  const voidPatch = { voided_at: new Date().toISOString(), voided_by: member.user.id }

  if (groupId) {
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
  await broadcast(ctx.db, member.organizationId, event.period_id, 'event.voided', {
    match_id: event.match_id,
  })

  return successResponse({ id: eventId }, 'Undone')
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
    .select('*, players!match_events_player_id_fkey(display_name, jersey_number, photo_url)')
    .eq('organization_id', member.organizationId)
    .is('voided_at', null)

  if (matchId) q = q.eq('match_id', matchId)
  if (sessionId) q = q.eq('session_id', sessionId)

  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  return successResponse(data ?? [], 'Events')
}
