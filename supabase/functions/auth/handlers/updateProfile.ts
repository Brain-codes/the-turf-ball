import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'
import { str, validate } from '../../_shared/validation.ts'

export async function updateProfile(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)
  const body = await ctx.body<{ full_name?: string; avatar_url?: string }>()

  validate(body as Record<string, unknown>, {
    full_name: [str(2, 80)],
    avatar_url: [str(0, 500)],
  })

  const patch: Record<string, unknown> = {}
  if (body.full_name !== undefined) patch.full_name = body.full_name.trim()
  if (body.avatar_url !== undefined) patch.avatar_url = body.avatar_url

  const { data, error } = await ctx.db
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id, email, full_name, avatar_url')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Profile updated')
}
