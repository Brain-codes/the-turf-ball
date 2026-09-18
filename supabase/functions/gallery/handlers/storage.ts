/**
 * Storage — a group's pool of Cloudinary accounts. One API behind one screen,
 * used by the team (their own group) and the super admin (any group).
 *
 * The API secret goes in once, is verified against Cloudinary, sealed with
 * AES-GCM and never returned. Responses carry only the last four characters.
 */

import type { Ctx } from '../../_shared/router.ts'
import { successResponse } from '../../_shared/response.ts'
import { AppError, badRequest, conflict, notFound } from '../../_shared/errors.ts'
import { bool, isArray, num, oneOf, required, str, uuid, validate } from '../../_shared/validation.ts'
import {
  effectivePct,
  isBroken,
  PROVIDER_NAMES,
  PROVIDERS,
  readSecrets,
  refreshAccount,
  sealSecrets,
  type AccountRow,
  type ProviderId,
  type AccountStatus,
  type Secrets,
  type UsageSnapshot,
} from '../../_shared/providers/index.ts'
import { requireSuperAdminFlag, storageAccess } from './_access.ts'

const PUBLIC_COLUMNS =
  'id, provider, config, kinds, storage_limit_bytes, bandwidth_limit_bytes, label, cloud_name, api_key, secret_last4, position, enabled, threshold_pct, usage_pct, credits_used, credits_limit, storage_bytes, bandwidth_bytes, transformations, resources, plan, pending_bytes, last_checked_at, last_error, created_at'

type Row = Omit<AccountRow, 'secret_ciphertext' | 'secret_iv'> & Record<string, unknown>

// Settings safe to show back. Key IDs are masked like the API key.
const SHOWN_CONFIG = ['public_url', 'url_endpoint', 'bucket', 'cdn_host', 'library_id', 'endpoint', 'account_id']

const GB = 1024 ** 3

/** Sensible starting limits for providers that don't report their plan size. Editable. */
const DEFAULT_LIMITS: Record<ProviderId, { storage: number | null; bandwidth: number | null }> = {
  cloudinary: { storage: null, bandwidth: null }, // reports credits itself
  imagekit: { storage: 20 * GB, bandwidth: 20 * GB },
  r2: { storage: 10 * GB, bandwidth: null }, // viewing is free
  b2: { storage: 10 * GB, bandwidth: null }, // free up to 3× storage
  bunny: { storage: null, bandwidth: null }, // pay as you go
}

/** Decorate accounts with a status and which one is taking uploads right now. */
function withStatus(rows: Row[]) {
  // Photos and videos roll over separately: a videos-only account (Bunny)
  // can be taking videos while photos go to another account.
  const claimed = { image: false, video: false }
  return rows.map((a) => {
    const kinds = (a.kinds ?? ['image', 'video']) as ('image' | 'video')[]
    const pct = effectivePct(a)
    const broken = isBroken(a)
    let status: AccountStatus
    if (!a.enabled) status = 'disabled'
    else if (broken) status = 'error'
    else if (pct >= Number(a.threshold_pct)) status = 'full'
    else if (kinds.some((k) => !claimed[k])) {
      status = pct >= Number(a.threshold_pct) - 10 ? 'filling' : 'active'
    } else status = 'standby'
    const takes = status === 'active' || status === 'filling' ? kinds.filter((k) => !claimed[k]) : []
    for (const k of takes) claimed[k] = true
    return {
      ...a,
      api_key: `${String(a.api_key).slice(0, 4)}••••`,
      provider: a.provider ?? 'cloudinary',
      provider_name: PROVIDER_NAMES[(a.provider ?? 'cloudinary') as ProviderId],
      config: Object.fromEntries(Object.entries((a.config ?? {}) as Record<string, string>).filter(([k]) => SHOWN_CONFIG.includes(k))),
      effective_pct: Math.round(pct * 10) / 10,
      status,
      taking_uploads: takes.length > 0,
      takes,
    }
  })
}

async function loadAccounts(ctx: Ctx, organizationId: string): Promise<Row[]> {
  const { data, error } = await ctx.db
    .from('cloudinary_accounts')
    .select(PUBLIC_COLUMNS)
    .eq('organization_id', organizationId)
    .order('position')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Row[]
}

async function audit(ctx: Ctx, adminId: string, superAdmin: boolean, action: string, orgId: string, details: Record<string, unknown>) {
  if (!superAdmin) return
  await ctx.db.from('admin_actions').insert({ admin_id: adminId, action, target_type: 'organization', target_id: orgId, details })
}

/** GET storage/:orgId — the whole storage screen in one call. */
export async function getStorage(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, false)
  const [org, accounts, stats, trash] = await Promise.all([
    ctx.db.from('organizations').select('id, name, slug, logo_url, gallery_enabled').eq('id', access.organizationId).single(),
    loadAccounts(ctx, access.organizationId),
    ctx.db.rpc('gallery_account_stats', { org: access.organizationId }),
    ctx.db.from('gallery_media').select('bytes, deleted_at').eq('organization_id', access.organizationId).not('deleted_at', 'is', null),
  ])
  if (org.error) throw new Error(org.error.message)

  const perAccount = new Map<string, Record<string, number>>()
  for (const s of (stats.data ?? []) as Record<string, number & string>[]) perAccount.set(s.account_id, s)

  const shaped = withStatus(accounts).map((a) => ({
    ...a,
    files: Number(perAccount.get(a.id)?.files ?? 0),
    file_bytes: Number(perAccount.get(a.id)?.bytes ?? 0),
    images: Number(perAccount.get(a.id)?.images ?? 0),
    videos: Number(perAccount.get(a.id)?.videos ?? 0),
    trashed: Number(perAccount.get(a.id)?.trashed ?? 0),
  }))

  const trashRows = (trash.data ?? []) as { bytes: number; deleted_at: string }[]
  const nextPurge = trashRows.map((r) => Date.parse(r.deleted_at) + 30 * 86400_000).sort((a, b) => a - b)[0]

  return successResponse({
    organization: org.data,
    can_manage: access.canManage,
    super_admin: access.superAdmin,
    accounts: shaped,
    totals: {
      accounts: shaped.length,
      files: shaped.reduce((n, a) => n + a.files, 0),
      bytes: shaped.reduce((n, a) => n + a.file_bytes, 0),
      images: shaped.reduce((n, a) => n + a.images, 0),
      videos: shaped.reduce((n, a) => n + a.videos, 0),
      trash_files: trashRows.length,
      trash_bytes: trashRows.reduce((n, r) => n + Number(r.bytes), 0),
      next_purge_at: nextPurge ? new Date(nextPurge).toISOString() : null,
    },
  })
}

/** Pull a provider's settings and secrets out of a request, trimmed and complete. */
function readFields(provider: ProviderId, body: Record<string, unknown>, partial = false) {
  const p = PROVIDERS[provider]
  const src = { ...(body.config as Record<string, unknown> ?? {}), ...(body.secrets as Record<string, unknown> ?? {}) }
  // Older app versions sent Cloudinary fields at the top level.
  for (const k of ['cloud_name', 'api_key', 'api_secret']) if (body[k] !== undefined && src[k] === undefined) src[k] = body[k]

  const config: Record<string, string> = {}
  const secrets: Secrets = {}
  const errors: Record<string, string[]> = {}
  const need = [...p.configFields, ...p.secretFields, ...(provider === 'r2' ? ['account_id'] : provider === 'b2' ? ['endpoint'] : [])]
  for (const f of need) {
    const v = typeof src[f] === 'string' ? (src[f] as string).trim() : ''
    if (!v) {
      if (!partial) errors[f] = ['This is required']
      continue
    }
    if (v.length > 300) errors[f] = ['That’s too long']
    if (p.secretFields.includes(f)) secrets[f] = v
    else config[f] = v
  }
  if (Object.keys(errors).length) throw badRequest('Please check the highlighted fields', errors)
  return { config, secrets }
}

const limitBytes = (v: unknown) => (v === null || v === '' ? null : v === undefined ? undefined : Math.round(Number(v) * GB))

function usageColumns(u: UsageSnapshot) {
  return {
    plan: u.plan ?? null,
    usage_pct: u.usage_pct ?? null,
    credits_used: u.credits_used ?? null,
    credits_limit: u.credits_limit ?? null,
    storage_bytes: u.storage_bytes ?? null,
    bandwidth_bytes: u.bandwidth_bytes ?? null,
    transformations: u.transformations ?? null,
    resources: u.resources ?? null,
  }
}

/** POST storage/:orgId/accounts — pick a provider, prove the keys work, then seal and store. */
export async function addAccount(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, true)
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    provider: [oneOf(Object.keys(PROVIDERS))],
    label: [required, str(1, 60)],
    threshold_pct: [num(10, 100)],
    storage_limit_gb: [num(0.1, 100000)],
    bandwidth_limit_gb: [num(0.1, 100000)],
  })
  const provider = (body.provider ?? 'cloudinary') as ProviderId
  const p = PROVIDERS[provider]
  const { config, secrets } = readFields(provider, body)
  const { identifier, apiKey } = p.identify(config)

  const { data: dupe } = await ctx.db.from('cloudinary_accounts').select('id').eq('organization_id', access.organizationId).eq('provider', provider).eq('cloud_name', identifier).maybeSingle()
  if (dupe) throw conflict(`That ${PROVIDER_NAMES[provider]} account is already attached to this group`)

  // Prove the keys work (and for R2/B2: public reads and browser uploads) before storing anything.
  const origin = typeof body.origin === 'string' ? body.origin.slice(0, 200) : ''
  const usage = await p.test({ ...config, cors_origin: origin }, secrets)

  const { data: last } = await ctx.db.from('cloudinary_accounts').select('position').eq('organization_id', access.organizationId).order('position', { ascending: false }).limit(1).maybeSingle()
  const sealed = await sealSecrets(secrets)
  const mainSecret = secrets[p.secretFields[0]]
  const defaults = DEFAULT_LIMITS[provider]

  const { data, error } = await ctx.db.from('cloudinary_accounts').insert({
    organization_id: access.organizationId,
    provider,
    config,
    kinds: p.kinds,
    label: String(body.label).trim(),
    cloud_name: identifier,
    api_key: apiKey,
    secret_ciphertext: sealed.ciphertext,
    secret_iv: sealed.iv,
    secret_last4: mainSecret.slice(-4),
    position: (last?.position ?? -1) + 1,
    threshold_pct: body.threshold_pct ?? 95,
    storage_limit_bytes: limitBytes(body.storage_limit_gb) ?? defaults.storage,
    bandwidth_limit_bytes: limitBytes(body.bandwidth_limit_gb) ?? defaults.bandwidth,
    ...usageColumns(usage),
    last_checked_at: new Date().toISOString(),
  }).select('id, label').single()
  if (error) throw new Error(error.message)

  await audit(ctx, access.user.id, access.superAdmin, 'storage.account.add', access.organizationId, { label: data.label, provider, identifier })
  return successResponse(data, `${data.label} connected`, {}, 201)
}

async function ownedAccount(ctx: Ctx, organizationId: string, id: string): Promise<AccountRow> {
  validate({ id }, { id: [required, uuid] })
  const { data, error } = await ctx.db.from('cloudinary_accounts').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw notFound('Storage account not found')
  return data as AccountRow
}

/** PATCH storage/:orgId/accounts/:id — rename, limits, pause, or replace the keys. */
export async function updateAccount(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, true)
  const account = await ownedAccount(ctx, access.organizationId, ctx.segments[3])
  const provider = (account.provider ?? 'cloudinary') as ProviderId
  const p = PROVIDERS[provider]
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, {
    label: [str(1, 60)],
    threshold_pct: [num(10, 100)],
    enabled: [bool],
    storage_limit_gb: [num(0.1, 100000)],
    bandwidth_limit_gb: [num(0.1, 100000)],
  })

  const patch: Record<string, unknown> = {}
  if (body.label !== undefined) patch.label = String(body.label).trim()
  if (body.threshold_pct !== undefined) patch.threshold_pct = body.threshold_pct
  if (body.enabled !== undefined) patch.enabled = body.enabled
  if (body.storage_limit_gb !== undefined) patch.storage_limit_bytes = limitBytes(body.storage_limit_gb)
  if (body.bandwidth_limit_gb !== undefined) patch.bandwidth_limit_bytes = limitBytes(body.bandwidth_limit_gb)

  const incoming = readFields(provider, body, true)
  const rotating = Object.keys(incoming.secrets).length > 0
  if (rotating) {
    // New keys, same account: keep the identifier, re-test with the merged settings.
    const config = { ...(account.config ?? {}), ...incoming.config }
    if (provider === 'cloudinary') {
      config.cloud_name = account.cloud_name
      config.api_key = incoming.config.api_key ?? account.api_key
    }
    const secrets = { ...(await readSecrets(account)), ...incoming.secrets }
    const { identifier, apiKey } = p.identify(config)
    if (identifier !== account.cloud_name) throw badRequest('Those keys are for a different account. Add it as a new account instead.')
    await p.test({ ...config, cors_origin: typeof body.origin === 'string' ? body.origin.slice(0, 200) : '' }, secrets)
    const sealed = await sealSecrets(secrets)
    Object.assign(patch, {
      config: provider === 'cloudinary' ? account.config : config,
      api_key: apiKey,
      secret_ciphertext: sealed.ciphertext,
      secret_iv: sealed.iv,
      secret_last4: secrets[p.secretFields[0]].slice(-4),
      last_error: null,
    })
  }
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to change')

  const { error } = await ctx.db.from('cloudinary_accounts').update(patch).eq('id', account.id)
  if (error) throw new Error(error.message)
  if (rotating) await refreshAccount(ctx.db, { ...account, ...patch } as AccountRow)

  await audit(ctx, access.user.id, access.superAdmin, 'storage.account.update', access.organizationId, {
    label: account.label,
    fields: Object.keys(patch).filter((k) => !k.startsWith('secret')),
    secret_rotated: rotating,
  })
  return successResponse({ id: account.id }, 'Saved')
}

/** POST storage/:orgId/accounts/:id/refresh — pull fresh numbers now. */
export async function refreshOne(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, false)
  const account = await ownedAccount(ctx, access.organizationId, ctx.segments[3])
  await refreshAccount(ctx.db, account)
  const { data } = await ctx.db.from('cloudinary_accounts').select('last_error').eq('id', account.id).single()
  if (data?.last_error) throw new AppError(data.last_error, 502)
  return successResponse({ id: account.id }, 'Usage updated')
}

/** POST storage/:orgId/refresh — refresh every account in the group. */
export async function refreshAll(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, false)
  const { data } = await ctx.db.from('cloudinary_accounts').select('*').eq('organization_id', access.organizationId)
  await Promise.all(((data ?? []) as AccountRow[]).map((a) => refreshAccount(ctx.db, a)))
  return successResponse({ refreshed: data?.length ?? 0 }, 'Usage updated')
}

/** POST storage/:orgId/reorder { ids } — the order uploads fill accounts in. */
export async function reorderAccounts(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, true)
  const body = await ctx.body<{ ids: string[] }>()
  validate(body as unknown as Record<string, unknown>, { ids: [required, isArray(1, 50)] })
  const current = await loadAccounts(ctx, access.organizationId)
  const known = new Set(current.map((a) => a.id))
  if (body.ids.length !== known.size || !body.ids.every((id) => known.has(id))) throw badRequest('The list must contain every account exactly once')

  await Promise.all(body.ids.map((id, position) => ctx.db.from('cloudinary_accounts').update({ position }).eq('id', id)))
  await audit(ctx, access.user.id, access.superAdmin, 'storage.account.reorder', access.organizationId, {})
  return successResponse({}, 'Order saved')
}

/** DELETE storage/:orgId/accounts/:id — only once nothing lives on it. */
export async function removeAccount(ctx: Ctx): Promise<Response> {
  const access = await storageAccess(ctx, true)
  const account = await ownedAccount(ctx, access.organizationId, ctx.segments[3])
  const { count } = await ctx.db.from('gallery_media').select('id', { count: 'exact', head: true }).eq('account_id', account.id)
  if (count) throw conflict(`${count} file${count === 1 ? '' : 's'} still live on this account. Pause it instead, or empty them from the trash first.`)

  await ctx.db.from('gallery_upload_intents').delete().eq('account_id', account.id)
  const { error } = await ctx.db.from('cloudinary_accounts').delete().eq('id', account.id)
  if (error) throw new Error(error.message)
  await audit(ctx, access.user.id, access.superAdmin, 'storage.account.remove', access.organizationId, { label: account.label })
  return successResponse({}, `${account.label} removed`)
}

/** PATCH storage/:orgId/settings { gallery_enabled } — super admin only. */
export async function updateSettings(ctx: Ctx): Promise<Response> {
  const admin = await requireSuperAdminFlag(ctx)
  const access = await storageAccess(ctx, true)
  const body = await ctx.body<Record<string, unknown>>()
  validate(body, { gallery_enabled: [required, bool] })
  const { error } = await ctx.db.from('organizations').update({ gallery_enabled: body.gallery_enabled }).eq('id', access.organizationId)
  if (error) throw new Error(error.message)
  await audit(ctx, admin.id, true, body.gallery_enabled ? 'gallery.enable' : 'gallery.disable', access.organizationId, {})
  return successResponse({}, body.gallery_enabled ? 'Gallery switched on' : 'Gallery switched off')
}

/** GET storage — every group, for the super admin's picker. */
export async function listAllStorage(ctx: Ctx): Promise<Response> {
  await requireSuperAdminFlag(ctx)
  const [orgs, accounts] = await Promise.all([
    ctx.db.from('organizations').select('id, name, slug, logo_url, gallery_enabled, status').is('deleted_at', null).order('name'),
    ctx.db.from('cloudinary_accounts').select(`organization_id, ${PUBLIC_COLUMNS}`).order('position'),
  ])
  if (orgs.error) throw new Error(orgs.error.message)

  const byOrg = new Map<string, Row[]>()
  for (const a of (accounts.data ?? []) as unknown as (Row & { organization_id: string })[]) {
    byOrg.set(a.organization_id, [...(byOrg.get(a.organization_id) ?? []), a])
  }

  return successResponse((orgs.data ?? []).map((o) => {
    const accs = withStatus(byOrg.get(o.id) ?? [])
    const active = accs.find((a) => a.taking_uploads)
    return {
      ...o,
      accounts: accs.length,
      full: accs.filter((a) => a.status === 'full').length,
      errors: accs.filter((a) => a.status === 'error').length,
      active_pct: active?.effective_pct ?? null,
      storage_bytes: accs.reduce((n, a) => n + Number((a as Record<string, unknown>).storage_bytes ?? 0), 0),
    }
  }))
}
