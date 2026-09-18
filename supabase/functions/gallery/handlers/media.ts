/**
 * Files in the gallery.
 *
 * Upload is two steps so big videos never pass through an Edge Function:
 *   1. uploads/sign    — we pick the storage account, record an intent, and
 *                        hand back a one-file signature.
 *   2. (browser → Cloudinary directly, chunked for large files)
 *   3. uploads/confirm — we look the file up on Cloudinary ourselves and only
 *                        then record it. Nothing the browser claims about the
 *                        file (size, type) is trusted.
 *
 * Delete is soft: files sit in the trash for 30 days, then the daily purge
 * removes them from Cloudinary for good. Admins can empty the trash sooner.
 */

import type { Ctx } from '../../_shared/router.ts'
import type { SupabaseClient } from '../../_shared/db.ts'
import { paginate, successResponse } from '../../_shared/response.ts'
import { AppError, badRequest, forbidden, notFound } from '../../_shared/errors.ts'
import { oneOf, required, str, uuid, validate } from '../../_shared/validation.ts'
import { pageParams } from '../../_shared/helpers.ts'
import { deliveryUrl, destroyMany, uploadFromUrl, type ResourceType } from '../../_shared/cloudinary.ts'
import { creds as cloudinaryCreds, zipUrl } from '../../_shared/providers/cloudinary.ts'
import { pickAccount, providerOf, readSecrets, type AccountRow, type MediaRef } from '../../_shared/providers/index.ts'
import { galleryMember, idList, isManager, MEDIA_SELECT, shapeMedia } from './_access.ts'
import type { MemberContext } from '../../_shared/auth.ts'

const TRASH_DAYS = 30

/* ---------------------------------------------------------------- listing */

export async function listMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const { page, perPage, from, to } = pageParams(ctx.query)
  const view = ctx.query.get('view')
  const album = ctx.query.get('album')
  const type = ctx.query.get('type')
  const sort = ctx.query.get('sort')
  const search = ctx.query.get('q')?.replace(/[,()"'\\*%_]/g, ' ').trim().slice(0, 60)

  let q = ctx.db.from('gallery_media').select(MEDIA_SELECT, { count: 'exact' }).eq('organization_id', m.organizationId)
  if (view === 'trash') {
    q = q.not('deleted_at', 'is', null)
    if (!isManager(m.role)) q = q.eq('uploaded_by', m.user.id)
  } else q = q.is('deleted_at', null)
  if (album === 'none') q = q.is('album_id', null)
  else if (album) {
    validate({ album }, { album: [uuid] })
    q = q.eq('album_id', album)
  }
  if (type === 'image' || type === 'video') q = q.eq('resource_type', type)
  if (ctx.query.get('mine') === '1') q = q.eq('uploaded_by', m.user.id)
  if (search) q = q.or(`title.ilike.%${search}%,original_filename.ilike.%${search}%`)

  if (view === 'trash') q = q.order('deleted_at', { ascending: false })
  else if (sort === 'popular') q = q.order('favourite_count', { ascending: false }).order('created_at', { ascending: false })
  else if (sort === 'largest') q = q.order('bytes', { ascending: false })
  else q = q.order('created_at', { ascending: sort === 'oldest' })

  const { data, error, count } = await q.range(from, to)
  if (error) throw new Error(error.message)

  return successResponse(
    (data ?? []).map((r) => ({
      ...shapeMedia(r, m.user.id),
      purge_at: r.deleted_at ? new Date(Date.parse(r.deleted_at) + TRASH_DAYS * 86400_000).toISOString() : null,
    })),
    'Request successful',
    { ...paginate(page, perPage, count ?? 0), role: m.role },
  )
}

/* ---------------------------------------------------------------- upload */

export async function signUpload(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    resource_type: [required, oneOf(['image', 'video'])],
    album_id: [uuid],
    filename: [str(0, 200)],
  })
  if (body.album_id) {
    const { data } = await ctx.db.from('gallery_albums').select('id').eq('id', body.album_id).eq('organization_id', m.organizationId).maybeSingle()
    if (!data) throw notFound('Album not found')
  }

  const type = body.resource_type as ResourceType
  const account = await pickAccount(ctx.db, m.organizationId, type)
  const base = `turfball/${m.organizationId}/${crypto.randomUUID()}`
  const signed = await providerOf(account).signUpload(account, await readSecrets(account), base, type, String(body.filename ?? ''))

  const { data: intent, error } = await ctx.db.from('gallery_upload_intents').insert({
    organization_id: m.organizationId,
    account_id: account.id,
    public_id: signed.public_id,
    provider_file_id: signed.provider_file_id ?? null,
    resource_type: type,
    album_id: body.album_id ?? null,
    created_by: m.user.id,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }).select('id').single()
  if (error) throw new Error(error.message)

  return successResponse({ intent_id: intent.id, provider: account.provider, plan: signed.plan })
}

export async function confirmUpload(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, { intent_id: [required, uuid], title: [str(0, 120)], filename: [str(0, 200)] })

  const { data: intent } = await ctx.db
    .from('gallery_upload_intents')
    .select('*, account:cloudinary_accounts(*)')
    .eq('id', body.intent_id)
    .eq('organization_id', m.organizationId)
    .eq('created_by', m.user.id)
    .maybeSingle()
  if (!intent) throw notFound('Upload not found')
  if (intent.completed_at) throw badRequest('This upload was already saved')
  // Allow a grace hour past the signature for long video uploads to finish.
  if (Date.parse(intent.expires_at) + 3600_000 < Date.now()) throw badRequest('This upload expired. Please try again.')

  const account = intent.account as AccountRow
  // Each provider checks the upload its own way (signed receipt, file
  // lookup, HEAD request) — nothing the browser claims is taken on trust
  // except harmless layout hints like width and height.
  const res = await providerOf(account).confirm(account, await readSecrets(account), intent, (body.upload ?? {}) as Record<string, unknown>)

  const { data: row, error } = await ctx.db.from('gallery_media').insert({
    organization_id: m.organizationId,
    album_id: intent.album_id,
    account_id: account.id,
    public_id: res.public_id,
    provider_file_id: res.provider_file_id ?? null,
    has_thumb: res.has_thumb ?? false,
    has_full: res.has_full ?? false,
    resource_type: intent.resource_type,
    format: res.format,
    bytes: res.bytes,
    width: res.width ?? null,
    height: res.height ?? null,
    duration: res.duration ?? null,
    version: res.version ?? null,
    title: body.title ? String(body.title).trim() : null,
    original_filename: body.filename ? String(body.filename).slice(0, 200) : null,
    uploaded_by: m.user.id,
  }).select(MEDIA_SELECT).single()
  if (error) throw new Error(error.message)

  await Promise.all([
    ctx.db.from('gallery_upload_intents').update({ completed_at: new Date().toISOString() }).eq('id', intent.id),
    ctx.db.from('cloudinary_accounts').update({ pending_bytes: Number(account.pending_bytes) + Number(res.bytes) }).eq('id', account.id),
  ])

  return successResponse(shapeMedia(row, m.user.id), 'Uploaded', {}, 201)
}

/* ---------------------------------------------------------------- editing */

/** Load rows the caller may act on. Non-admins may only touch their own uploads. */
async function actionable(ctx: Ctx, m: MemberContext, ids: string[], trashed: boolean | null) {
  let q = ctx.db.from('gallery_media').select('*, account:cloudinary_accounts(*)').eq('organization_id', m.organizationId).in('id', ids)
  if (trashed === true) q = q.not('deleted_at', 'is', null)
  if (trashed === false) q = q.is('deleted_at', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (rows.length === 0) throw notFound('Nothing to change')
  if (!isManager(m.role) && rows.some((r) => r.uploaded_by !== m.user.id)) {
    throw forbidden('You can only change files you uploaded. Ask a group admin for the rest.')
  }
  return rows
}

export async function updateMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const id = ctx.segments[1]
  validate({ id }, { id: [required, uuid] })
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, { title: [str(0, 120)] })
  await actionable(ctx, m, [id], null)
  const { data, error } = await ctx.db.from('gallery_media').update({ title: body.title ? String(body.title).trim() : null }).eq('id', id).select(MEDIA_SELECT).single()
  if (error) throw new Error(error.message)
  return successResponse(shapeMedia(data, m.user.id), 'Saved')
}

export async function moveMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const body = await ctx.body<{ ids?: unknown; album_id?: string | null }>()
  const ids = idList(body)
  if (body.album_id) {
    validate({ album_id: body.album_id }, { album_id: [uuid] })
    const { data } = await ctx.db.from('gallery_albums').select('id').eq('id', body.album_id).eq('organization_id', m.organizationId).maybeSingle()
    if (!data) throw notFound('Album not found')
  }
  const rows = await actionable(ctx, m, ids, false)
  const { error } = await ctx.db.from('gallery_media').update({ album_id: body.album_id ?? null }).in('id', rows.map((r) => r.id))
  if (error) throw new Error(error.message)
  return successResponse({ moved: rows.length }, `Moved ${rows.length} item${rows.length === 1 ? '' : 's'}`)
}

export async function trashMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const rows = await actionable(ctx, m, idList(await ctx.body()), false)
  const { error } = await ctx.db.from('gallery_media').update({ deleted_at: new Date().toISOString(), deleted_by: m.user.id }).in('id', rows.map((r) => r.id))
  if (error) throw new Error(error.message)
  return successResponse({ trashed: rows.length }, `Moved ${rows.length} to the trash. It empties itself after ${TRASH_DAYS} days.`)
}

export async function restoreMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const rows = await actionable(ctx, m, idList(await ctx.body()), true)
  const { error } = await ctx.db.from('gallery_media').update({ deleted_at: null, deleted_by: null }).in('id', rows.map((r) => r.id))
  if (error) throw new Error(error.message)
  return successResponse({ restored: rows.length }, `Restored ${rows.length} item${rows.length === 1 ? '' : 's'}`)
}

/**
 * Remove files from Cloudinary, then from the database. Grouped by account
 * and type; an account that fails keeps its rows so nothing is orphaned.
 */
// deno-lint-ignore no-explicit-any
export async function purgeRows(db: SupabaseClient, rows: any[]): Promise<{ purged: number; failed: number }> {
  const groups = new Map<string, { account: AccountRow; rows: typeof rows }>()
  for (const r of rows) {
    const g = groups.get(r.account_id) ?? { account: r.account, rows: [] as typeof rows }
    g.rows.push(r)
    groups.set(r.account_id, g)
  }
  let purged = 0
  let failed = 0
  for (const g of groups.values()) {
    try {
      await providerOf(g.account).destroy(g.account, await readSecrets(g.account), g.rows as MediaRef[])
      const { error } = await db.from('gallery_media').delete().in('id', g.rows.map((r) => r.id))
      if (error) throw new Error(error.message)
      purged += g.rows.length
    } catch (err) {
      failed += g.rows.length
      console.error(JSON.stringify({ level: 'error', msg: 'gallery purge failed', account: g.account.id, error: err instanceof Error ? err.message : String(err) }))
    }
  }
  return { purged, failed }
}

export async function purgeMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  if (!isManager(m.role)) throw forbidden('Only group admins can delete files forever')
  const rows = await actionable(ctx, m, idList(await ctx.body()), true)
  const { purged, failed } = await purgeRows(ctx.db, rows)
  if (failed && !purged) throw new AppError('Couldn’t delete from Cloudinary. Check the storage account and try again.', 502)
  return successResponse({ purged, failed }, failed ? `Deleted ${purged}; ${failed} couldn’t be removed yet` : `Deleted ${purged} forever`)
}

export async function emptyTrash(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  if (!isManager(m.role)) throw forbidden('Only group admins can empty the trash')
  const { data, error } = await ctx.db.from('gallery_media').select('*, account:cloudinary_accounts(*)').eq('organization_id', m.organizationId).not('deleted_at', 'is', null).limit(500)
  if (error) throw new Error(error.message)
  if (!data?.length) return successResponse({ purged: 0, failed: 0 }, 'The trash is already empty')
  const { purged, failed } = await purgeRows(ctx.db, data)
  return successResponse({ purged, failed }, failed ? `Deleted ${purged}; ${failed} couldn’t be removed yet` : `Trash emptied — ${purged} deleted forever`)
}

/* ------------------------------------------------------------- compress */

const COMPRESS: Record<ResourceType, { transform: string; ext: string }> = {
  image: { transform: 'c_limit,w_2560,h_2560,q_auto:good', ext: 'jpg' },
  video: { transform: 'c_limit,w_1920,h_1920,q_auto:good,vc_h264', ext: 'mp4' },
}

/**
 * Shrink stored files in place: Cloudinary re-encodes from its own copy, we
 * keep whichever is smaller, and delete the other. Frees real storage.
 */
export async function compressMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const rows = await actionable(ctx, m, idList(await ctx.body(), 20), false)
  let saved = 0
  let done = 0
  const failures: string[] = []

  let unsupported = 0
  for (const r of rows) {
    if (r.compressed) continue
    const account = r.account as AccountRow
    const type = r.resource_type as ResourceType
    // Only Cloudinary can re-encode stored files. The others keep what was uploaded
    // (photos are already shrunk on the phone before upload).
    if (!providerOf(account).canCompress) {
      unsupported++
      continue
    }
    try {
      const creds = cloudinaryCreds(account, await readSecrets(account))
      const spec = COMPRESS[type]
      const src = deliveryUrl(creds.cloud, type, r.public_id, spec.transform, spec.ext)
      const newId = `turfball/${m.organizationId}/${crypto.randomUUID()}`
      const out = await uploadFromUrl(creds, type, src, newId)

      if (out.bytes >= Number(r.bytes)) {
        await destroyMany(creds, type, [newId])
        await ctx.db.from('gallery_media').update({ compressed: true }).eq('id', r.id)
        continue
      }
      const { error } = await ctx.db.from('gallery_media').update({
        public_id: out.public_id,
        format: out.format,
        bytes: out.bytes,
        width: out.width ?? r.width,
        height: out.height ?? r.height,
        version: out.version,
        compressed: true,
      }).eq('id', r.id)
      if (error) {
        await destroyMany(creds, type, [newId])
        throw new Error(error.message)
      }
      await destroyMany(creds, type, [r.public_id])
      saved += Number(r.bytes) - out.bytes
      done++
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }

  const mb = (saved / 1024 / 1024).toFixed(1)
  if (failures.length && !done) throw new AppError(`Couldn’t compress: ${failures[0]}`, 502)
  if (unsupported && !done) return successResponse({ compressed: 0, saved_bytes: 0, failed: 0 }, 'Those files are on storage that can’t compress after upload — photos were already shrunk when they went up')
  return successResponse({ compressed: done, saved_bytes: saved, failed: failures.length }, done ? `Compressed ${done} — saved ${mb} MB` : 'Already as small as it gets')
}

/* ------------------------------------------------------------- download */

// deno-lint-ignore no-explicit-any
export async function downloadLinks(db: SupabaseClient, rows: any[], zipName: string) {
  await db.rpc('gallery_bump_download', { ids: rows.map((r) => r.id) })

  // One zip per Cloudinary account and type; everything else as single links.
  const zips = new Map<string, { account: AccountRow; type: ResourceType; ids: string[] }>()
  const singles: typeof rows = []
  for (const r of rows) {
    if (rows.length > 1 && providerOf(r.account).canZip) {
      const k = `${r.account_id}:${r.resource_type}`
      const g = zips.get(k) ?? { account: r.account, type: r.resource_type, ids: [] as string[] }
      g.ids.push(r.public_id)
      zips.set(k, g)
    } else singles.push(r)
  }

  const links: { url: string; label: string }[] = []
  const parts = zips.size + (singles.length ? 1 : 0)
  let part = 1
  for (const g of zips.values()) {
    const c = cloudinaryCreds(g.account, await readSecrets(g.account))
    links.push({
      url: await zipUrl(c, g.type, g.ids, `${zipName}${parts > 1 ? `-part${part}` : ''}`),
      label: `${g.ids.length} ${g.type === 'video' ? 'video' : 'photo'}${g.ids.length === 1 ? '' : 's'} (zip)`,
    })
    part++
  }
  const secretCache = new Map<string, Awaited<ReturnType<typeof readSecrets>>>()
  for (const r of singles) {
    if (!secretCache.has(r.account_id)) secretCache.set(r.account_id, await readSecrets(r.account))
    links.push({ url: await providerOf(r.account).downloadUrl(r.account, secretCache.get(r.account_id)!, r as MediaRef), label: r.title || r.original_filename || 'Download' })
  }
  return links
}

export async function downloadMedia(ctx: Ctx): Promise<Response> {
  const m = await galleryMember(ctx)
  const ids = idList(await ctx.body(), 500)
  const { data, error } = await ctx.db.from('gallery_media').select('*, account:cloudinary_accounts(*)').eq('organization_id', m.organizationId).in('id', ids)
  if (error) throw new Error(error.message)
  if (!data?.length) throw notFound()
  return successResponse({ links: await downloadLinks(ctx.db, data, 'turfball-gallery') })
}
