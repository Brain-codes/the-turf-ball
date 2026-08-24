import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { assertOwned, requireMember } from '../../_shared/auth.ts'
import { badRequest, conflict } from '../../_shared/errors.ts'
import { audit } from '../../_shared/helpers.ts'
import { int, oneOf, str, validate } from '../../_shared/validation.ts'

const CATEGORIES = ['goal', 'assist', 'own_goal', 'yellow_card', 'red_card', 'attendance'] as const

const POSITIONS = [
  'GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF',
] as const
const FEET = ['left', 'right', 'both'] as const

/** The only profile fields a merge is allowed to overwrite on the kept player. */
const OVERRIDABLE_FIELDS = [
  'display_name', 'jersey_number', 'position', 'preferred_foot', 'whatsapp_nickname', 'photo_url',
] as const

/**
 * Merges a duplicate player profile into the one being kept. The organizer
 * picks which categories of history move over (goals, assists, cards,
 * attendance) — whatever's left unchecked stays on the duplicate, which is
 * archived rather than deleted, so a wrong category choice is never
 * unrecoverable. See merge_players() in the DB for the actual data move,
 * which runs as one function so it can never half-apply.
 */
export async function mergePlayer(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const keepId = ctx.segments[0]

  const body = await ctx.body<{
    duplicate_player_id?: string
    categories?: string[]
    delete_duplicate?: boolean
    field_overrides?: Record<string, unknown>
  }>()
  const duplicateId = body.duplicate_player_id
  const categories = body.categories ?? []
  const deleteDuplicate = body.delete_duplicate === true
  const fieldOverrides: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body.field_overrides ?? {})) {
    if (value !== undefined) fieldOverrides[key] = value
  }

  if (!duplicateId) throw badRequest('Pick the duplicate profile to merge in')
  if (duplicateId === keepId) throw badRequest('Pick two different players to merge')

  const bad = categories.find((c) => !(CATEGORIES as readonly string[]).includes(c))
  if (bad) throw badRequest(`Unknown category: ${bad}`)

  const badField = Object.keys(fieldOverrides).find(
    (k) => !(OVERRIDABLE_FIELDS as readonly string[]).includes(k),
  )
  if (badField) throw badRequest(`Unknown field: ${badField}`)

  validate(fieldOverrides, {
    display_name: [str(1, 40)],
    jersey_number: [int(0, 99)],
    position: [oneOf(POSITIONS)],
    preferred_foot: [oneOf(FEET)],
    whatsapp_nickname: [str(0, 40)],
  })

  await assertOwned(ctx.db, 'players', keepId, member.organizationId)
  await assertOwned(ctx.db, 'players', duplicateId, member.organizationId)

  const { data: pair } = await ctx.db
    .from('players')
    .select('id, display_name, status')
    .eq('organization_id', member.organizationId)
    .in('id', [keepId, duplicateId])

  const keep = pair?.find((p) => p.id === keepId)
  const duplicate = pair?.find((p) => p.id === duplicateId)
  if (duplicate?.status === 'merged') throw badRequest('That player has already been merged into someone else')

  const { error } = await ctx.db.rpc('merge_players', {
    p_org: member.organizationId,
    p_keep: keepId,
    p_duplicate: duplicateId,
    p_categories: categories,
    p_delete: deleteDuplicate,
  })
  if (error) throw new Error(error.message)

  if (Object.keys(fieldOverrides).length > 0) {
    const { error: fieldError } = await ctx.db
      .from('players')
      .update(fieldOverrides)
      .eq('id', keepId)
      .eq('organization_id', member.organizationId)
    if (fieldError) {
      if (fieldError.code === '23505') throw conflict('Another player already has that shirt number')
      throw new Error(fieldError.message)
    }
  }

  await audit(
    ctx.db,
    member.organizationId,
    member.user.id,
    'player.merge',
    'player',
    keepId,
    { duplicate_id: duplicateId, categories, deleted: deleteDuplicate, field_overrides: fieldOverrides },
    null,
  )

  const { data: merged } = await ctx.db.from('players').select('*').eq('id', keepId).single()

  return successResponse(
    merged,
    deleteDuplicate
      ? `${duplicate?.display_name ?? 'That player'} merged into ${keep?.display_name ?? 'this player'} and removed`
      : `${duplicate?.display_name ?? 'That player'} merged into ${keep?.display_name ?? 'this player'}`,
  )
}
