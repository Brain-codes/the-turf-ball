import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { isArray, required, validate } from '../../_shared/validation.ts'

/**
 * Onboarding's fast path: type a name, press enter, repeat. Nobody is filling
 * a six-field form twenty-four times to get their squad in.
 */
export async function bulkCreatePlayers(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')
  const body = await ctx.body<{ names: string[] }>()

  validate(body as unknown as Record<string, unknown>, {
    names: [required, isArray(1, 200)],
  })

  const cleaned = body.names
    .map((n) => String(n ?? '').trim())
    .filter((n) => n.length > 0 && n.length <= 40)

  if (cleaned.length === 0) {
    return successResponse([], 'No names to add')
  }

  // Skip anyone already on the roster rather than erroring the whole batch —
  // a duplicate typed in a hurry should not lose the other nineteen names.
  const { data: existing } = await ctx.db
    .from('players')
    .select('display_name')
    .eq('organization_id', member.organizationId)

  const taken = new Set((existing ?? []).map((p: { display_name: string }) => p.display_name.toLowerCase()))

  const rows = cleaned
    .filter((n, i) => !taken.has(n.toLowerCase()) && cleaned.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i)
    .map((name) => {
      const parts = name.split(/\s+/)
      return {
        organization_id: member.organizationId,
        first_name: parts[0],
        last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
        display_name: name,
        status: 'active' as const,
        created_by: member.user.id,
      }
    })

  if (rows.length === 0) {
    return successResponse([], 'Those players are already in your squad')
  }

  const { data, error } = await ctx.db.from('players').insert(rows).select('*')
  if (error) throw new Error(error.message)

  const skipped = cleaned.length - rows.length
  return successResponse(
    data,
    skipped > 0
      ? `${data.length} player(s) added, ${skipped} already in your squad`
      : `${data.length} player(s) added`,
    { added: data.length, skipped },
    201,
  )
}
