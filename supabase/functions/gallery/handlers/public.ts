/**
 * The public gallery at /g/:slug. No login. Only files in public albums (or
 * in no album) are ever returned — unless the viewer is a signed-in member of
 * the group, who also sees its private albums.
 *
 * Favourites are anonymous: the browser sends a random visitor id it keeps,
 * one heart per visitor per item, and the database keeps the count.
 */

import type { Ctx } from '../../_shared/router.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { badRequest, notFound } from '../../_shared/errors.ts'
import { bool, required, str, uuid, validate } from '../../_shared/validation.ts'
import { pageParams } from '../../_shared/helpers.ts'
import { featureEnabled } from '../../_shared/features.ts'
import { requireUser } from '../../_shared/auth.ts'
import { idList, shapePublicMedia } from './_access.ts'
import { downloadLinks } from './media.ts'

const PUBLIC_MEDIA = 'id, album_id, public_id, provider_file_id, has_thumb, has_full, resource_type, format, width, height, duration, version, title, favourite_count, created_at, account:cloudinary_accounts(provider, cloud_name, config)'

async function galleryOrg(ctx: Ctx) {
  const slug = ctx.segments[1]
  if (!slug || !/^[a-z0-9-]{3,60}$/.test(slug)) throw notFound('Gallery not found')
  if (!(await featureEnabled(ctx.db, 'gallery'))) throw notFound('Gallery not found')
  const { data } = await ctx.db
    .from('organizations')
    .select('id, name, short_name, slug, logo_url, description, location, gallery_enabled, status, deleted_at')
    .eq('slug', slug)
    .maybeSingle()
  if (!data || !data.gallery_enabled || data.status !== 'active' || data.deleted_at) throw notFound('Gallery not found')

  // A signed-in member of this group also sees private albums.
  let member = false
  try {
    const user = await requireUser(ctx.req)
    const { data: m } = await ctx.db.from('organization_members').select('id').eq('organization_id', data.id).eq('user_id', user.id).eq('status', 'active').maybeSingle()
    member = !!m
  } catch { /* anonymous visitor */ }

  const { data: albums } = await ctx.db
    .from('gallery_albums')
    .select('id, title, description, visibility, event_date, created_at, cover:gallery_media!gallery_albums_cover_fk(id, public_id, provider_file_id, has_thumb, has_full, resource_type, format, width, height, version, deleted_at, account:cloudinary_accounts(provider, cloud_name, config))')
    .eq('organization_id', data.id)
    .order('created_at', { ascending: false })
  const visible = (albums ?? []).filter((a) => member || a.visibility === 'public')
  return { org: data, member, albums: visible }
}

function visibleFilter(albumIds: string[]) {
  return albumIds.length ? `album_id.is.null,album_id.in.(${albumIds.join(',')})` : 'album_id.is.null'
}

export async function publicGallery(ctx: Ctx): Promise<Response> {
  const { org, member, albums } = await galleryOrg(ctx)
  const ids = albums.map((a) => a.id)
  const [counts, hero] = await Promise.all([
    ctx.db.rpc('gallery_album_counts', { org: org.id }),
    ctx.db.from('gallery_media').select(PUBLIC_MEDIA).eq('organization_id', org.id).is('deleted_at', null)
      .eq('resource_type', 'image').or(visibleFilter(ids))
      .order('favourite_count', { ascending: false }).order('created_at', { ascending: false }).limit(14),
  ])

  const tally = new Map<string, { photos: number; videos: number }>()
  for (const r of (counts.data ?? []) as { album_id: string | null; photos: number; videos: number }[]) {
    tally.set(r.album_id ?? 'none', { photos: Number(r.photos), videos: Number(r.videos) })
  }
  const shapedAlbums = albums.map((a) => {
    // deno-lint-ignore no-explicit-any
    const cover = a.cover as any
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      visibility: a.visibility,
      event_date: a.event_date,
      cover: cover && !cover.deleted_at ? shapePublicMedia(cover) : null,
      ...(tally.get(a.id) ?? { photos: 0, videos: 0 }),
    }
  }).filter((a) => a.photos + a.videos > 0 || member)

  const unsorted = tally.get('none') ?? { photos: 0, videos: 0 }
  const all = [...shapedAlbums, unsorted].reduce((t, a) => ({ photos: t.photos + a.photos, videos: t.videos + a.videos }), { photos: 0, videos: 0 })

  const { gallery_enabled: _g, status: _s, deleted_at: _d, id: _id, ...publicOrg } = org
  return successResponse({
    organization: publicOrg,
    member,
    albums: shapedAlbums,
    unsorted,
    totals: all,
    hero: (hero.data ?? []).map(shapePublicMedia),
  })
}

export async function publicMedia(ctx: Ctx): Promise<Response> {
  const { org, albums } = await galleryOrg(ctx)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const album = ctx.query.get('album')
  const type = ctx.query.get('type')
  const sort = ctx.query.get('sort')
  const ids = albums.map((a) => a.id)

  let q = ctx.db.from('gallery_media').select(PUBLIC_MEDIA, { count: 'exact' }).eq('organization_id', org.id).is('deleted_at', null)
  if (album === 'none') q = q.is('album_id', null)
  else if (album) {
    if (!ids.includes(album)) throw notFound('Album not found')
    q = q.eq('album_id', album)
  } else q = q.or(visibleFilter(ids))
  if (type === 'image' || type === 'video') q = q.eq('resource_type', type)
  if (ctx.query.get('only')) {
    const only = ctx.query.get('only')!.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)
    q = q.in('id', only.length ? only : ['00000000-0000-0000-0000-000000000000'])
  }
  if (sort === 'popular') q = q.order('favourite_count', { ascending: false }).order('created_at', { ascending: false })
  else q = q.order('created_at', { ascending: sort === 'oldest' })

  const { data, error, count } = await q.range(from, to)
  if (error) throw new Error(error.message)
  return successResponse((data ?? []).map(shapePublicMedia), 'Request successful', paginate(page, perPage, count ?? 0))
}

/** Load public-visible rows by id for this gallery. */
async function visibleRows(ctx: Ctx, ids: string[], select: string) {
  const { org, albums } = await galleryOrg(ctx)
  const { data, error } = await ctx.db.from('gallery_media').select(select).eq('organization_id', org.id).is('deleted_at', null)
    .in('id', ids).or(visibleFilter(albums.map((a) => a.id)))
  if (error) throw new Error(error.message)
  return { org, rows: data ?? [] }
}

export async function favourite(ctx: Ctx): Promise<Response> {
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, { media_id: [required, uuid], visitor_id: [required, str(16, 64)], on: [required, bool] })
  if (!/^[A-Za-z0-9_-]+$/.test(String(body.visitor_id))) throw badRequest('Invalid visitor')
  const { rows } = await visibleRows(ctx, [String(body.media_id)], 'id')
  if (!rows.length) throw notFound()

  if (body.on) {
    await ctx.db.from('gallery_favourites').upsert({ media_id: body.media_id, visitor_id: body.visitor_id }, { onConflict: 'media_id,visitor_id', ignoreDuplicates: true })
  } else {
    await ctx.db.from('gallery_favourites').delete().eq('media_id', body.media_id).eq('visitor_id', body.visitor_id)
  }
  const { data } = await ctx.db.from('gallery_media').select('favourite_count').eq('id', body.media_id).single()
  return successResponse({ favourite_count: data?.favourite_count ?? 0, on: body.on })
}

export async function publicDownload(ctx: Ctx): Promise<Response> {
  const ids = idList(await ctx.body(), 200)
  const { org, rows } = await visibleRows(ctx, ids, 'id, account_id, public_id, provider_file_id, has_thumb, has_full, resource_type, format, width, height, version, title, original_filename, account:cloudinary_accounts(*)')
  if (!rows.length) throw notFound()
  return successResponse({ links: await downloadLinks(ctx.db, rows, `${org.slug}-gallery`) })
}
