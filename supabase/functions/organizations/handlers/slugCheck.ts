import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'
import { slugify } from '../../_shared/validation.ts'

export async function slugCheck(ctx: Ctx): Promise<Response> {
  await requireUser(ctx.req)
  const desired = slugify(ctx.query.get('slug') ?? '')

  if (desired.length < 3) {
    return successResponse({ slug: desired, available: false }, 'Too short — use at least 3 characters')
  }

  const { data } = await ctx.db
    .from('organizations')
    .select('id')
    .eq('slug', desired)
    .maybeSingle()

  return successResponse(
    { slug: desired, available: !data },
    data ? 'That link is taken' : 'That link is available',
  )
}
