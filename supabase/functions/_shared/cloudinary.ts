/**
 * Cloudinary, server side only. Every call that needs the API secret happens
 * here, inside an Edge Function. The browser only ever receives:
 *   - a signed, single-use upload signature (one public_id, ~1 hour), or
 *   - a signed archive URL (download only, expires in an hour).
 * Neither can list, delete or change anything else on the account.
 */

import { AppError } from './errors.ts'

export type ResourceType = 'image' | 'video'


export interface Creds {
  cloud: string
  key: string
  secret: string
}

const API = 'https://api.cloudinary.com/v1_1'

/** Formats we accept. Signed into every upload so Cloudinary enforces it too. */
export const ALLOWED_FORMATS = 'jpg,jpeg,png,webp,heic,heif,gif,avif,mp4,mov,webm,m4v,3gp'


/* ---------------------------------------------------------------- signing */

async function sha1Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cloudinary's request signature: sorted k=v pairs joined by &, then the secret. Arrays join with ','. */
export function sign(params: Record<string, string | number | string[]>, secret: string): Promise<string> {
  const payload = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? (params[k] as string[]).join(',') : params[k]}`)
    .join('&')
  return sha1Hex(payload + secret)
}

const now = () => Math.floor(Date.now() / 1000)

/** Parameters the browser posts, with the file, straight to Cloudinary. */
export async function signedUpload(c: Creds, publicId: string, type: ResourceType) {
  const params = { public_id: publicId, timestamp: now(), allowed_formats: ALLOWED_FORMATS }
  return {
    upload_url: `${API}/${c.cloud}/${type}/upload`,
    fields: { ...params, api_key: c.key, signature: await sign(params, c.secret) },
  }
}

/**
 * Cloudinary signs every upload response with sha1("public_id=…&version=…" +
 * secret). Checking it proves the file landed without an Admin API call —
 * the free plan allows only 500 of those an hour, and a 300-photo match day
 * would otherwise burn most of them.
 */
export async function verifyUploadSignature(c: Creds, publicId: string, version: number | string, signature: string): Promise<boolean> {
  const expected = await sha1Hex(`public_id=${publicId}&version=${version}${c.secret}`)
  return expected === signature
}

/* ------------------------------------------------------------- admin API */

async function admin<T>(c: Creds, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}/${c.cloud}/${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Basic ${btoa(`${c.key}:${c.secret}`)}` },
    })
  } catch {
    throw new AppError('Could not reach Cloudinary. Try again in a moment.', 502)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } }).error?.message ?? `Cloudinary error ${res.status}`
    if (res.status === 401) throw new AppError('Cloudinary rejected these keys. Check the cloud name, API key and secret.', 400)
    if (res.status === 404) throw new AppError('Not found on Cloudinary', 404)
    if (res.status === 420 || res.status === 429) throw new AppError('Cloudinary is rate-limiting this account. Try again shortly.', 429)
    throw new AppError(msg, 502)
  }
  return body as T
}

export interface Usage {
  plan?: string
  credits?: { usage?: number; limit?: number; used_percent?: number }
  storage?: { usage?: number }
  bandwidth?: { usage?: number }
  transformations?: { usage?: number }
  resources?: number
}

export function getUsage(c: Creds) {
  return admin<Usage>(c, 'usage')
}

export interface Resource {
  public_id: string
  resource_type: ResourceType
  format: string
  bytes: number
  width?: number
  height?: number
  duration?: number
  version: number
}

export function getResource(c: Creds, type: ResourceType, publicId: string) {
  return admin<Resource>(c, `resources/${type}/upload/${encodeURI(publicId)}`)
}

/** Delete up to 100 at a time. Missing ids count as done. */
export async function destroyMany(c: Creds, type: ResourceType, publicIds: string[]): Promise<void> {
  for (let i = 0; i < publicIds.length; i += 100) {
    const qs = new URLSearchParams()
    for (const id of publicIds.slice(i, i + 100)) qs.append('public_ids[]', id)
    qs.set('invalidate', 'true')
    await admin(c, `resources/${type}/upload?${qs}`, { method: 'DELETE' })
  }
}

/**
 * Re-encode a stored file smaller, server side: Cloudinary fetches its own
 * transformed delivery URL and stores the result under a new id.
 */
export async function uploadFromUrl(c: Creds, type: ResourceType, url: string, publicId: string): Promise<Resource> {
  const params = { public_id: publicId, timestamp: now() }
  const form = new FormData()
  form.set('file', url)
  for (const [k, v] of Object.entries(params)) form.set(k, String(v))
  form.set('api_key', c.key)
  form.set('signature', await sign(params, c.secret))
  const res = await fetch(`${API}/${c.cloud}/${type}/upload`, { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new AppError((body as { error?: { message?: string } }).error?.message ?? 'Compression failed', 502)
  return body as Resource
}

export function deliveryUrl(cloud: string, type: ResourceType, publicId: string, transform: string, ext: string) {
  return `https://res.cloudinary.com/${cloud}/${type}/upload/${transform ? `${transform}/` : ''}${publicId}.${ext}`
}

/** A signed, expiring zip download URL. The browser fetches it directly. */
export async function archiveUrl(c: Creds, type: ResourceType, publicIds: string[], name: string): Promise<string> {
  const params: Record<string, string | number | string[]> = {
    mode: 'download',
    target_format: 'zip',
    flatten_folders: 'true',
    public_ids: publicIds,
    target_public_id: name,
    timestamp: now(),
    expires_at: now() + 3600,
  }
  const signature = await sign(params, c.secret)
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(`${k}[]`, x))
    else qs.set(k, String(v))
  }
  qs.set('api_key', c.key)
  qs.set('signature', signature)
  return `${API}/${c.cloud}/${type}/generate_archive?${qs}`
}
