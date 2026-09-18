/**
 * Albums. Each is public (anyone with the gallery link) or private (signed-in
 * members only). Anyone in the group can create one; the creator or an
 * admin can change or delete it. Deleting an album never deletes files —
 * they drop back into "Unsorted".
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { forbidden, notFound } from '../../_shared/errors.ts'
import { oneOf, required, str, uuid, validate } from '../../_shared/validation.ts'
import { galleryMember, isManager, shapePublicMedia } from './_access.ts'

const VIS = ['public', 'private'] as const

export async function listAlbums(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const [albums, counts] = await Promise.all([
    ctx.db.from('gallery_albums').select('*, cover:gallery_media!gallery_albums_cover_fk(id, public_id, provider_file_id, has_thumb, has_full, resource_type, format, width, height, version, deleted_at, account:cloudinary_accounts(provider, cloud_name, config))').eq('organization_id', m.organizationId).order('created_at', { ascending: false }),
    ctx.db.rpc('gallery_album_counts', { org: m.organizationId }),
  ])
  if (albums.error) throw new Error(albums.error.message)

  const tally = new Map<string, { photos: number; videos: number }>()
  for (const r of (counts.data ?? []) as { album_id: string | null; photos: number; videos: number }[]) {
    tally.set(r.album_id ?? 'none', { photos: Number(r.photos), videos: Number(r.videos) })
  }

  return successResponse({
    albums: (albums.data ?? []).map((a) => ({
      ...a,
      // deno-lint-ignore no-explicit-any
      cover: a.cover && !(a.cover as any).deleted_at ? shapePublicMedia(a.cover) : null,
      ...(tally.get(a.id) ?? { photos: 0, videos: 0 }),
    })),
    unsorted: tally.get('none') ?? { photos: 0, videos: 0 },
  })
}

export async function createAlbum(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    title: [required, str(1, 80)],
    description: [str(0, 400)],
    visibility: [oneOf(VIS)],
  })
  const { data, error } = await ctx.db.from('gallery_albums').insert({
    organization_id: m.organizationId,
    title: String(body.title).trim(),
    description: body.description ? String(body.description).trim() : null,
    visibility: body.visibility ?? 'public',
    event_date: typeof body.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.event_date) ? body.event_date : null,
    created_by: m.user.id,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return successResponse(data, 'Album created', {}, 201)
}

async function editableAlbum(ctx: Ctx) {
  const m = await galleryMember(ctx)
  const id = ctx.segments[1]
  validate({ id }, { id: [required, uuid] })
  const { data } = await ctx.db.from('gallery_albums').select('*').eq('id', id).eq('organization_id', m.organizationId).maybeSingle()
  if (!data) throw notFound('Album not found')
  if (!isManager(m.role) && data.created_by !== m.user.id) throw forbidden('Only the person who made this album or a group admin can change it')
  return { m, album: data }
}

export async function updateAlbum(ctx: Ctx): Promise<Response> {
  const { m, album } = await editableAlbum(ctx)
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    title: [str(1, 80)],
    description: [str(0, 400)],
    visibility: [oneOf(VIS)],
    cover_media_id: [uuid],
  })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) patch.title = String(body.title).trim()
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null
  if (body.visibility !== undefined) patch.visibility = body.visibility
  if (body.event_date !== undefined) patch.event_date = typeof body.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.event_date) ? body.event_date : null
  if (body.cover_media_id !== undefined) {
    if (body.cover_media_id) {
      const { data } = await ctx.db.from('gallery_media').select('id').eq('id', body.cover_media_id).eq('organization_id', m.organizationId).maybeSingle()
      if (!data) throw notFound('Cover not found')
    }
    patch.cover_media_id = body.cover_media_id || null
  }
  const { data, error } = await ctx.db.from('gallery_albums').update(patch).eq('id', album.id).select('*').single()
  if (error) throw new Error(error.message)
  return successResponse(data, 'Album saved')
}

export async function deleteAlbum(ctx: Ctx): Promise<Response> {
  const { album } = await editableAlbum(ctx)
  const { error } = await ctx.db.from('gallery_albums').delete().eq('id', album.id)
  if (error) throw new Error(error.message)
  return successResponse({}, `“${album.title}” deleted — its files are now in Unsorted`)
}
