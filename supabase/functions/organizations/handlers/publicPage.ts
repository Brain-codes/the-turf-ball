import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { conflict } from '../../_shared/errors.ts'
import { bool, slugify, validate } from '../../_shared/validation.ts'

const FIELDS = [
  'is_published', 'show_photos', 'show_cards', 'show_punctuality', 'show_sessions', 'theme',
] as const

export async function updatePublicPage(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin', ctx.segments[0])
  const body = await ctx.body<Record<string, unknown>>()

  validate(body, {
    is_published: [bool],
    show_photos: [bool],
    show_cards: [bool],
    show_punctuality: [bool],
    show_sessions: [bool],
  })

  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f]

  // Changing the slug breaks every link already shared in WhatsApp, so it is
  // an explicit, separate act rather than a side effect of renaming the group.
  if (typeof body.slug === 'string' && body.slug.trim()) {
    const desired = slugify(body.slug)
    const { data: taken } = await ctx.db
      .from('public_pages')
      .select('organization_id')
      .eq('slug', desired)
      .maybeSingle()
    if (taken && taken.organization_id !== member.organizationId) {
      throw conflict('That link is already taken. Try another.')
    }
    patch.slug = desired
    await ctx.db.from('organizations').update({ slug: desired }).eq('id', member.organizationId)
  }

  const { data, error } = await ctx.db
    .from('public_pages')
    .update(patch)
    .eq('organization_id', member.organizationId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Share page updated')
}
