/**
 * Every account on the platform. Super admins can block or unblock sign-in
 * and grant or remove super admin. Blocking uses Supabase Auth's own ban,
 * so a blocked user can't get a new session at all.
 */

import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { requireSuperAdmin } from '../../_shared/auth.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { bool, required, uuid, validate } from '../../_shared/validation.ts'
import { pageParams } from '../../_shared/helpers.ts'
import { likeTerm, logAction } from './_log.ts'

const FOREVER = '876000h' // 100 years

export async function listUsers(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const term = likeTerm(ctx.query.get('search'))

  let q = ctx.db
    .from('profiles')
    .select('id, email, full_name, is_platform_admin, created_at, deleted_at, organization_members(role, status, organizations(id, name, slug))', { count: 'exact' })
  if (term) q = q.or(`email.ilike.${term},full_name.ilike.${term}`)

  const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, to)
  if (error) throw new Error(error.message)

  // Sign-in state lives in Auth, not in profiles.
  const rows = await Promise.all((data ?? []).map(async (p: Record<string, unknown>) => {
    const { data: auth } = await ctx.db.auth.admin.getUserById(String(p.id))
    const bannedUntil = (auth?.user as { banned_until?: string } | undefined)?.banned_until
    return {
      ...p,
      blocked: !!bannedUntil && new Date(bannedUntil) > new Date(),
      last_sign_in_at: auth?.user?.last_sign_in_at ?? null,
      email_confirmed: !!auth?.user?.email_confirmed_at,
    }
  }))

  return successResponse(rows, 'Request successful', paginate(page, perPage, count ?? 0))
}

export async function updateUser(ctx: Ctx): Promise<Response> {
  const admin = await requireSuperAdmin(ctx.req, ctx.db)
  const id = ctx.segments[1]
  const body = await ctx.body<Record<string, unknown>>()
  validate({ ...body, id }, { id: [required, uuid], blocked: [bool], is_platform_admin: [bool] })

  if (id === admin.id && (body.blocked === true || body.is_platform_admin === false)) {
    throw badRequest("You can't block yourself or remove your own super admin access")
  }

  const { data: profile, error } = await ctx.db.from('profiles').select('id, email').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!profile) throw notFound('User not found')

  if (typeof body.blocked === 'boolean') {
    const { error: banErr } = await ctx.db.auth.admin.updateUserById(id, { ban_duration: body.blocked ? FOREVER : 'none' })
    if (banErr) throw new Error(banErr.message)
    await logAction(ctx.db, admin.id, body.blocked ? 'user.block' : 'user.unblock', 'user', id, { email: profile.email })
  }

  if (typeof body.is_platform_admin === 'boolean') {
    const { error: roleErr } = await ctx.db.from('profiles').update({ is_platform_admin: body.is_platform_admin }).eq('id', id)
    if (roleErr) throw new Error(roleErr.message)
    await logAction(ctx.db, admin.id, body.is_platform_admin ? 'user.make_admin' : 'user.remove_admin', 'user', id, { email: profile.email })
  }

  return successResponse({ id }, 'User updated')
}
