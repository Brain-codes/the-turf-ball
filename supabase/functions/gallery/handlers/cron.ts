/**
 * Called by pg_cron through pg_net (migration 20260918120000), never by a
 * browser. Guarded by a shared secret held in Vault and the function env.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { notFound } from '../../_shared/errors.ts'
import { safeEqual } from '../../_shared/secretBox.ts'
import { providerOf, readSecrets, refreshAccount, type AccountRow, type MediaRef } from '../../_shared/providers/index.ts'
import { purgeRows } from './media.ts'

function requireCron(ctx: Ctx) {
  const expected = Deno.env.get('GALLERY_CRON_SECRET')
  const got = ctx.req.headers.get('x-cron-secret') ?? ''
  if (!expected || !safeEqual(got, expected)) throw notFound('Endpoint not found')
}

export async function cronUsage(ctx: Ctx): Promise<Response> {
  requireCron(ctx)
  const { data } = await ctx.db.from('cloudinary_accounts').select('*').eq('enabled', true)
  const accounts = (data ?? []) as AccountRow[]
  for (let i = 0; i < accounts.length; i += 5) {
    await Promise.all(accounts.slice(i, i + 5).map((a) => refreshAccount(ctx.db, a)))
  }
  ctx.log.info('gallery usage refreshed', { accounts: accounts.length })
  return successResponse({ refreshed: accounts.length })
}

export async function cronPurge(ctx: Ctx): Promise<Response> {
  requireCron(ctx)
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data } = await ctx.db.from('gallery_media').select('*, account:cloudinary_accounts(*)').lt('deleted_at', cutoff).limit(1000)
  const result = data?.length ? await purgeRows(ctx.db, data) : { purged: 0, failed: 0 }

  // Uploads that were signed but never confirmed: remove any orphan file.
  const stale = new Date(Date.now() - 86400_000).toISOString()
  const { data: intents } = await ctx.db.from('gallery_upload_intents').select('*, account:cloudinary_accounts(*)').is('completed_at', null).lt('expires_at', stale).limit(500)
  let orphans = 0
  for (const i of intents ?? []) {
    try {
      const acc = i.account as AccountRow
      const ref: MediaRef = { public_id: i.public_id, provider_file_id: i.provider_file_id, resource_type: i.resource_type, format: null, version: null, width: null, height: null, has_thumb: false, has_full: false }
      await providerOf(acc).destroy(acc, await readSecrets(acc), [ref])
      await ctx.db.from('gallery_upload_intents').delete().eq('id', i.id)
      orphans++
    } catch { /* retried tomorrow */ }
  }
  await ctx.db.from('gallery_upload_intents').delete().not('completed_at', 'is', null).lt('created_at', stale)

  ctx.log.info('gallery purge', { ...result, orphans })
  return successResponse({ ...result, orphans })
}
