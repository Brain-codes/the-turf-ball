import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest } from '../../_shared/errors.ts'
import { int, isArray, required, str, validate } from '../../_shared/validation.ts'

interface Body {
  session_id: string
  side_a: string[]
  side_b?: string[]
  goalkeeper_a?: string
  goalkeeper_b?: string
  duration_minutes?: number
  side_a_label?: string
  side_b_label?: string
}

export async function createMatch(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db)
  const body = await ctx.body<Body>()

  validate(body as unknown as Record<string, unknown>, {
    session_id: [required, str(36, 36)],
    side_a: [required, isArray(1, 22)],
    // Team splitting is no longer part of the live flow — everyone present
    // goes on side_a and side_b stays empty. Still accepted (not removed)
    // so a two-team match can be created another way later if ever needed.
    side_b: [isArray(0, 22)],
    duration_minutes: [int(1, 180)],
    side_a_label: [str(1, 20)],
    side_b_label: [str(1, 20)],
  })

  await assertOwned(ctx.db, 'sessions', body.session_id, member.organizationId)

  const sideB = body.side_b ?? []

  // A player cannot be on both teams. Easy to do by accident when tapping
  // quickly, and it would silently corrupt every stat for that match.
  const overlap = body.side_a.filter((id) => sideB.includes(id))
  if (overlap.length > 0) {
    throw badRequest('A player cannot be on both sides')
  }

  const { data: sequenceRows } = await ctx.db
    .from('matches')
    .select('sequence')
    .eq('session_id', body.session_id)
    .order('sequence', { ascending: false })
    .limit(1)

  const sequence = (sequenceRows?.[0]?.sequence ?? 0) + 1

  const { data: match, error } = await ctx.db
    .from('matches')
    .insert({
      organization_id: member.organizationId,
      session_id: body.session_id,
      sequence,
      duration_minutes: body.duration_minutes ?? 20,
      side_a_label: body.side_a_label ?? 'Blue',
      side_b_label: body.side_b_label ?? 'Red',
      status: 'pending',
      created_by: member.user.id,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  const rows = [
    ...body.side_a.map((id) => ({
      organization_id: member.organizationId,
      match_id: match.id,
      player_id: id,
      side: 'a' as const,
      is_goalkeeper: id === body.goalkeeper_a,
    })),
    ...sideB.map((id) => ({
      organization_id: member.organizationId,
      match_id: match.id,
      player_id: id,
      side: 'b' as const,
      is_goalkeeper: id === body.goalkeeper_b,
    })),
  ]

  const { error: rosterError } = await ctx.db.from('match_players').insert(rows)
  if (rosterError) {
    await ctx.db.from('matches').delete().eq('id', match.id)
    throw new Error(rosterError.message)
  }

  return successResponse({ ...match, players: rows }, `Match ${sequence} ready`, {}, 201)
}
