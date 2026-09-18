/**
 * Who may do what in the gallery.
 *
 * - Any active member (uploader and up) can upload, browse and manage their
 *   own files. Admins and owners manage everything, including the trash.
 * - Storage (the Cloudinary accounts) is one screen shared by the team and
 *   the super admin: every member can view it, owners/admins manage it, and
 *   the super admin can do both for any group.
 */

import type { Ctx } from '../../_shared/router.ts'
import { requireMember, requireUser, type AuthUser, type MemberContext } from '../../_shared/auth.ts'
import { requireFeature } from '../../_shared/features.ts'
import { AppError, notFound } from '../../_shared/errors.ts'
import { uuid, required, validate } from '../../_shared/validation.ts'
import { mediaUrls } from '../../_shared/providers/index.ts'

export const isManager = (role: string) => role === 'owner' || role === 'admin'

/** A member of a group whose gallery is switched on. */
export async function galleryMember(ctx: Ctx): Promise<MemberContext> {
  await requireFeature(ctx.db, 'gallery', 'Galleries are switched off right now.')
  const member = await requireMember(ctx.req, ctx.db, 'uploader')
  const { data } = await ctx.db.from('organizations').select('gallery_enabled').eq('id', member.organizationId).single()
  if (!data?.gallery_enabled) throw new AppError('The gallery isn’t switched on for this group yet.', 403)
  return member
}

export interface StorageAccess {
  user: AuthUser
  organizationId: string
  superAdmin: boolean
  canManage: boolean
}

async function isSuperAdmin(ctx: Ctx, userId: string): Promise<boolean> {
  const { data } = await ctx.db.from('profiles').select('is_platform_admin, deleted_at').eq('id', userId).maybeSingle()
  return !!data?.is_platform_admin && !data.deleted_at
}

export async function storageAccess(ctx: Ctx, manage: boolean): Promise<StorageAccess> {
  const organizationId = ctx.segments[1]
  validate({ organization_id: organizationId }, { organization_id: [required, uuid] })

  const user = await requireUser(ctx.req)
  if (await isSuperAdmin(ctx, user.id)) {
    const { data } = await ctx.db.from('organizations').select('id').eq('id', organizationId).is('deleted_at', null).maybeSingle()
    if (!data) throw notFound('Group not found')
    return { user, organizationId, superAdmin: true, canManage: true }
  }
  const member = await requireMember(ctx.req, ctx.db, manage ? 'admin' : 'uploader', organizationId)
  return { user, organizationId, superAdmin: false, canManage: isManager(member.role) }
}

export async function requireSuperAdminFlag(ctx: Ctx): Promise<AuthUser> {
  const user = await requireUser(ctx.req)
  if (!(await isSuperAdmin(ctx, user.id))) throw notFound('Endpoint not found')
  return user
}

/** Media ids from a body, validated. */
export function idList(body: { ids?: unknown }, max = 200): string[] {
  const ids = body.ids
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('Pick at least one item', 400)
  if (ids.length > max) throw new AppError(`You can act on up to ${max} items at once`, 400)
  for (const id of ids) validate({ id }, { id: [required, uuid] })
  return ids as string[]
}

/** The account fields needed to build a file's URLs. Never secrets. */
export const ACCOUNT_URL_FIELDS = 'account:cloudinary_accounts(provider, cloud_name, config)'

export const MEDIA_SELECT =
  `id, album_id, account_id, public_id, provider_file_id, has_thumb, has_full, resource_type, format, bytes, width, height, duration, version, title, original_filename, favourite_count, download_count, compressed, created_at, deleted_at, uploaded_by, ${ACCOUNT_URL_FIELDS}, uploader:profiles!gallery_media_uploaded_by_fkey(id, full_name)`

// deno-lint-ignore no-explicit-any
const urlsFor = (row: any) => mediaUrls(row.account ?? null, row)

// deno-lint-ignore no-explicit-any
export function shapeMedia(row: any, viewerId?: string) {
  const { account, uploader, account_id: _a, public_id: _p, provider_file_id: _f, has_thumb: _t, has_full: _h, ...rest } = row
  return {
    ...rest,
    provider: account?.provider ?? 'cloudinary',
    urls: urlsFor(row),
    uploader: uploader ? { id: uploader.id, name: uploader.full_name } : null,
    mine: viewerId ? row.uploaded_by === viewerId : false,
  }
}

/** Public shape — no uploader identity, no storage internals, just URLs. */
// deno-lint-ignore no-explicit-any
export function shapePublicMedia(row: any) {
  return {
    id: row.id,
    album_id: row.album_id,
    resource_type: row.resource_type,
    format: row.format,
    width: row.width,
    height: row.height,
    duration: row.duration,
    urls: urlsFor(row),
    title: row.title,
    favourite_count: row.favourite_count,
    created_at: row.created_at,
  }
}
