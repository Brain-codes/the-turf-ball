import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { requireMember } from '../../_shared/auth.ts'
import { badRequest, conflict, notFound } from '../../_shared/errors.ts'
import { email, oneOf, required, validate } from '../../_shared/validation.ts'
import { audit } from '../../_shared/helpers.ts'

const ROLES = ['admin', 'recorder'] as const

export async function listMembers(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'admin')

  const { data, error } = await ctx.db
    .from('organization_members')
    .select('id, role, status, invited_email, created_at, profiles(id, full_name, email, avatar_url)')
    .eq('organization_id', member.organizationId)
    .neq('status', 'revoked')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return successResponse(data ?? [], 'Members')
}

/**
 * Invite someone to help. The common case is handing a friend the phone on
 * match day, so 'recorder' is the default — they can record events but cannot
 * change the scoring rules or delete anyone.
 */
export async function inviteMember(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const body = await ctx.body<{ email: string; role?: typeof ROLES[number] }>()

  validate(body as unknown as Record<string, unknown>, {
    email: [required, email],
    role: [oneOf(ROLES)],
  })

  const invitedEmail = body.email.trim().toLowerCase()

  const { data: existing } = await ctx.db
    .from('organization_members')
    .select('id, status')
    .eq('organization_id', member.organizationId)
    .eq('invited_email', invitedEmail)
    .neq('status', 'revoked')
    .maybeSingle()

  if (existing) throw conflict('That person has already been invited')

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  // If they already have an account, attach it now so accepting is one click.
  const { data: profile } = await ctx.db
    .from('profiles')
    .select('id')
    .eq('email', invitedEmail)
    .maybeSingle()

  const { data, error } = await ctx.db
    .from('organization_members')
    .insert({
      organization_id: member.organizationId,
      user_id: profile?.id ?? null,
      invited_email: invitedEmail,
      role: body.role ?? 'recorder',
      status: 'invited',
      invite_token: token,
      invite_expires_at: expires.toISOString(),
    })
    .select('id, role, status, invited_email')
    .single()

  if (error) throw new Error(error.message)

  await audit(ctx.db, member.organizationId, member.user.id, 'member.invite', 'member', data.id)

  // The link is returned rather than emailed: rule2.txt §14 rules out any
  // third-party mail provider, and Supabase's native templates cover auth only.
  // The organizer shares this in WhatsApp, which is where their group already is.
  return successResponse(
    { ...data, invite_token: token, invite_path: `/join/${token}` },
    'Invitation ready — share the link with them',
    {},
    201,
  )
}

export async function updateMember(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const memberId = ctx.segments[0]
  const body = await ctx.body<{ role: typeof ROLES[number] }>()

  validate(body as unknown as Record<string, unknown>, { role: [required, oneOf(ROLES)] })

  const { data: target } = await ctx.db
    .from('organization_members')
    .select('id, role')
    .eq('id', memberId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!target) throw notFound('Member not found')
  if (target.role === 'owner') throw badRequest('The owner’s role cannot be changed')

  const { data, error } = await ctx.db
    .from('organization_members')
    .update({ role: body.role })
    .eq('id', memberId)
    .select('id, role, status')
    .single()

  if (error) throw new Error(error.message)
  return successResponse(data, 'Role updated')
}

export async function removeMember(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx.req, ctx.db, 'owner')
  const memberId = ctx.segments[0]

  const { data: target } = await ctx.db
    .from('organization_members')
    .select('id, role')
    .eq('id', memberId)
    .eq('organization_id', member.organizationId)
    .maybeSingle()

  if (!target) throw notFound('Member not found')
  if (target.role === 'owner') throw badRequest('The owner cannot be removed')

  const { error } = await ctx.db
    .from('organization_members')
    .update({ status: 'revoked', invite_token: null })
    .eq('id', memberId)

  if (error) throw new Error(error.message)

  await audit(ctx.db, member.organizationId, member.user.id, 'member.remove', 'member', memberId)
  return successResponse({ id: memberId }, 'Access removed')
}
