/**
 * The storage-provider layer. Handlers talk to this, never to a provider
 * directly: pick an account, read its secrets, build URLs, refresh usage.
 */

import type { SupabaseClient } from '../db.ts'
import { AppError } from '../errors.ts'
import { openSecret, sealSecret } from '../secretBox.ts'
import { cloudinary } from './cloudinary.ts'
import { imagekit } from './imagekit.ts'
import { b2, r2 } from './s3.ts'
import { bunny } from './bunny.ts'
import type { AccountRow, MediaRef, MediaUrls, Provider, ProviderId, ResourceType, Secrets, UsageSnapshot } from './types.ts'

export * from './types.ts'

export const PROVIDERS: Record<ProviderId, Provider> = { cloudinary, imagekit, r2, b2, bunny }

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  cloudinary: 'Cloudinary',
  imagekit: 'ImageKit',
  r2: 'Cloudflare R2',
  b2: 'Backblaze B2',
  bunny: 'Bunny.net',
}

export function providerOf(acc: Pick<AccountRow, 'provider'>): Provider {
  const p = PROVIDERS[acc.provider ?? 'cloudinary']
  if (!p) throw new Error(`Unknown storage provider ${acc.provider}`)
  return p
}

/** Secrets are an encrypted JSON object. Rows from before providers existed hold a bare Cloudinary secret. */
export async function readSecrets(acc: Pick<AccountRow, 'secret_ciphertext' | 'secret_iv'>): Promise<Secrets> {
  const plain = await openSecret(acc.secret_ciphertext, acc.secret_iv)
  if (plain.startsWith('{')) {
    try {
      return JSON.parse(plain) as Secrets
    } catch { /* fall through */ }
  }
  return { api_secret: plain }
}

export function sealSecrets(secrets: Secrets) {
  return sealSecret(JSON.stringify(secrets))
}

/** URLs for a stored file. `acc` needs provider, cloud_name and config. */
export function mediaUrls(acc: Pick<AccountRow, 'provider' | 'cloud_name' | 'config'> | null, m: MediaRef): MediaUrls {
  if (!acc) return { thumb: '', full: '', video: null, video_hd: null, download: '' }
  return providerOf(acc).urls({ provider: acc.provider ?? 'cloudinary', cloud_name: acc.cloud_name, config: acc.config ?? {} }, m)
}

const GB = 1024 ** 3

/**
 * How full an account is, 0–100, counting uploads since the last check.
 * Cloudinary reports credits; the others are measured against the limits the
 * team entered. No limits (pay-as-you-go) = never full.
 */
export function effectivePct(a: Pick<AccountRow, 'usage_pct' | 'credits_used' | 'credits_limit' | 'pending_bytes' | 'storage_bytes' | 'bandwidth_bytes' | 'storage_limit_bytes' | 'bandwidth_limit_bytes'>): number {
  if (a.credits_limit && a.credits_used != null) {
    // 1 Cloudinary credit = 1 GB of storage.
    return ((Number(a.credits_used) + a.pending_bytes / GB) / Number(a.credits_limit)) * 100
  }
  const parts: number[] = []
  if (a.storage_limit_bytes) parts.push(((Number(a.storage_bytes ?? 0) + a.pending_bytes) / Number(a.storage_limit_bytes)) * 100)
  if (a.bandwidth_limit_bytes && a.bandwidth_bytes != null) parts.push((Number(a.bandwidth_bytes) / Number(a.bandwidth_limit_bytes)) * 100)
  if (parts.length) return Math.max(...parts)
  return Number(a.usage_pct ?? 0)
}

/** An account whose keys have never worked is skipped, not treated as empty. */
export const isBroken = (a: Pick<AccountRow, 'last_error' | 'last_checked_at' | 'usage_pct' | 'storage_bytes' | 'credits_used'>) =>
  !!a.last_error && a.usage_pct == null && a.storage_bytes == null && a.credits_used == null

/** Pull fresh numbers and store them. Records the error instead of throwing. */
export async function refreshAccount(db: SupabaseClient, account: AccountRow): Promise<void> {
  try {
    const { data: stored } = await db.rpc('gallery_account_bytes', { acc: account.id })
    const u: UsageSnapshot = await providerOf(account).usage(account, await readSecrets(account), Number(stored ?? 0))
    const { error } = await db.from('cloudinary_accounts').update({
      plan: u.plan ?? null,
      usage_pct: u.usage_pct ?? null,
      credits_used: u.credits_used ?? null,
      credits_limit: u.credits_limit ?? null,
      storage_bytes: u.storage_bytes ?? null,
      bandwidth_bytes: u.bandwidth_bytes ?? null,
      transformations: u.transformations ?? null,
      resources: u.resources ?? null,
      pending_bytes: 0,
      last_checked_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', account.id)
    if (error) throw new Error(error.message)
  } catch (err) {
    await db.from('cloudinary_accounts').update({
      last_checked_at: new Date().toISOString(),
      last_error: err instanceof Error ? err.message : String(err),
    }).eq('id', account.id)
  }
}

const STALE_MS = 30 * 60 * 1000

/**
 * The account a new upload of this type goes to: the first enabled one, in
 * the order the team set, that takes this type and is under its threshold.
 * Stale numbers are refreshed first so a full account isn't picked on old data.
 */
export async function pickAccount(db: SupabaseClient, organizationId: string, type: ResourceType): Promise<AccountRow> {
  const load = async () => {
    const { data, error } = await db
      .from('cloudinary_accounts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('enabled', true)
      .order('position')
    if (error) throw new Error(error.message)
    return ((data ?? []) as AccountRow[]).filter((a) => (a.kinds ?? ['image', 'video']).includes(type))
  }

  let accounts = await load()
  const noun = type === 'video' ? 'videos' : 'photos'
  if (accounts.length === 0) throw new AppError(`No storage for ${noun} is attached to this group yet. Ask your group admin to add an account under Storage.`, 409)

  const stale = accounts.filter((a) => !a.last_checked_at || Date.now() - Date.parse(a.last_checked_at) > STALE_MS)
  if (stale.length) {
    await Promise.all(stale.map((a) => refreshAccount(db, a)))
    accounts = await load()
  }

  const pick = accounts.find((a) => !isBroken(a) && effectivePct(a) < Number(a.threshold_pct))
  if (!pick) throw new AppError(`All of this group’s storage for ${noun} is full. Add another account under Storage to keep uploading.`, 507)
  return pick
}
