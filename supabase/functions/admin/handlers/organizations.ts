/**
 * Every group on the platform. Super admins can look inside any group and
 * suspend or restore it. Suspension blocks the group's own members
 * (requireMember) and hides it from every public surface.
 */

import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { requireSuperAdmin } from '../../_shared/auth.ts'
import { notFound } from '../../_shared/errors.ts'
import { oneOf, required, str, uuid, validate } from '../../_shared/validation.ts'
import { pageParams } from '../../_shared/helpers.ts'
import { likeTerm, logAction } from './_log.ts'

export async function listOrganizations(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const term = likeTerm(ctx.query.get('search'))
  const status = ctx.query.get('status')

  let q = ctx.db
    .from('organizations')
    .select('id, name, slug, logo_url, location, venue, status, created_at, deleted_at, owner:profiles!organizations_owner_id_fkey(id, email, full_name), organization_members(count), players(count), sessions(count)', { count: 'exact' })
    .is('deleted_at', null)
  if (term) q = q.ilike('name', term)
  if (status === 'active' || status === 'archived') q = q.eq('status', status)

  const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, to)
  if (error) throw new Error(error.message)

  const rows = (data ?? []).map((o: Record<string, unknown>) => ({
    ...o,
    members: (o.organization_members as { count: number }[])?.[0]?.count ?? 0,
    players: (o.players as { count: number }[])?.[0]?.count ?? 0,
    sessions: (o.sessions as { count: number }[])?.[0]?.count ?? 0,
    organization_members: undefined,
  }))
  return successResponse(rows, 'Request successful', paginate(page, perPage, count ?? 0))
}

export async function getOrganization(ctx: Ctx): Promise<Response> {
  await requireSuperAdmin(ctx.req, ctx.db)
  const id = ctx.segments[1]
  validate({ id }, { id: [required, uuid] })

  const { data: org, error } = await ctx.db
    .from('organizations')
    .select('*, owner:profiles!organizations_owner_id_fkey(id, email, full_name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!org) throw notFound('Group not found')

  const [members, sessions, page, stats] = await Promise.all([
    ctx.db.from('organization_members').select('role, status, created_at, profiles(id, email, full_name)').eq('organization_id', id),
    ctx.db.from('sessions').select('id, title, session_date, status').eq('organization_id', id).order('session_date', { ascending: false }).limit(10),
    ctx.db.from('public_pages').select('slug, is_published, view_count').eq('organization_id', id).maybeSingle(),
    ctx.db.from('org_alltime_stats').select('*').eq('organization_id', id).maybeSingle(),
  ])

  return successResponse({
    organization: org,
    members: members.data ?? [],
    recent_sessions: sessions.data ?? [],
    public_page: page.data,
    stats: stats.data,
  })
}

export async function updateOrganization(ctx: Ctx): Promise<Response> {
  const admin = await requireSuperAdmin(ctx.req, ctx.db)
  const id = ctx.segments[1]
  const body = await ctx.body<Record<string, unknown>>()
  validate({ ...body, id }, {
    id: [required, uuid],
    status: [required, oneOf(['active', 'archived'])],
    reason: [str(0, 300)],
  })

  const { data, error } = await ctx.db
    .from('organizations')
    .update({ status: body.status })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id, name, status')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Group not found')

  await logAction(ctx.db, admin.id, body.status === 'archived' ? 'group.suspend' : 'group.restore', 'organization', id, {
    name: data.name,
    reason: body.reason ?? null,
  })
  return successResponse(data, body.status === 'archived' ? `${data.name} suspended` : `${data.name} restored`)
}
