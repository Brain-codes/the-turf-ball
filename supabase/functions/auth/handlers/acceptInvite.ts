import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireUser } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { required, str, validate } from '../../_shared/validation.ts'

export async function acceptInvite(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req)
  const body = await ctx.body<{ token: string }>()
  validate(body as unknown as Record<string, unknown>, { token: [required, str(10, 200)] })

  const { data: invite } = await ctx.db
    .from('organization_members')
    .select('id, organization_id, role, status, invite_expires_at, organizations(name)')
    .eq('invite_token', body.token)
    .maybeSingle()

  if (!invite) throw notFound('That invitation link is not valid')
  if (invite.status === 'revoked') throw badRequest('That invitation has been withdrawn')
  if (invite.status === 'active') return successResponse({ organization_id: invite.organization_id }, 'You are already in this group')
  if (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date()) {
    throw badRequest('That invitation has expired. Ask the organizer to send a new one.')
  }

  const { error } = await ctx.db
    .from('organization_members')
    .update({ user_id: user.id, status: 'active', invite_token: null })
    .eq('id', invite.id)

  if (error) throw new Error(error.message)

  const org = invite.organizations as { name?: string } | null
  return successResponse(
    { organization_id: invite.organization_id, role: invite.role },
    `You have joined ${org?.name ?? 'the group'}`,
  )
}
