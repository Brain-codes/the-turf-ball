/**
 * S3-compatible object storage: Cloudflare R2 and Backblaze B2.
 *
 * Plain storage — no resizing — so the phone uploads three files per photo
 * (original, 2000px full-screen copy, 640px grid image) and a poster frame
 * per video, each with its own one-hour presigned PUT URL. Viewing is free
 * on R2 and mostly free on B2, so originals are fine to serve.
 *
 * The bucket must be publicly readable (served from its public URL) and allow
 * browser PUTs from our site (CORS). test() checks both and says which is off.
 */

import { AppError, badRequest } from '../errors.ts'
import { presign } from './sigv4.ts'
import type { AccountRow, MediaRef, Provider, ProviderId, Secrets } from './types.ts'
import { extOf } from './types.ts'

interface Target {
  host: string
  region: string
  bucket: string
  publicUrl: string
  keyId: string
}

type Cfg = Record<string, string>

const SITE_ORIGIN = Deno.env.get('SITE_URL')?.replace(/\/$/, '') ?? 'https://the-turf-ball.vercel.app'

const thumbKey = (k: string) => `${k}_thumb.jpg`
const fullKey = (k: string) => `${k}_full.jpg`

function makeS3(id: ProviderId, target: (c: Cfg) => Target, name: string): Provider {
  const url = (c: Cfg, s: Secrets, method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, query?: Record<string, string>) => {
    const t = target(c)
    return presign({ method, host: t.host, path: `/${t.bucket}/${key}`, region: t.region, accessKeyId: t.keyId, secretAccessKey: s.secret_access_key, query })
  }
  const publicUrl = (c: Cfg, key: string) => `${target(c).publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`

  const head = async (c: Cfg, s: Secrets, key: string) => {
    const res = await fetch(await url(c, s, 'HEAD', key)).catch(() => null)
    if (!res) throw new AppError(`Could not reach ${name}. Try again in a moment.`, 502)
    await res.body?.cancel()
    return res
  }

  const provider: Provider = {
    id,
    kinds: ['image', 'video'],
    canCompress: false,
    canZip: false,
    configFields: ['bucket', 'access_key_id', 'public_url'],
    secretFields: ['secret_access_key'],

    identify: (c) => {
      target(c) // validates endpoint fields
      if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(c.bucket ?? '')) throw badRequest('Please check the highlighted fields', { bucket: ['Bucket names are lowercase letters, numbers, dots and dashes'] })
      if (!/^https:\/\/[^\s/]+/.test(c.public_url ?? '')) throw badRequest('Please check the highlighted fields', { public_url: ['Paste the bucket’s public URL, starting with https://'] })
      return { identifier: c.bucket, apiKey: c.access_key_id }
    },

    // Write, read publicly, allow browser uploads, delete — everything the gallery needs.
    test: async (c, s) => {
      const key = 'turfball/.connection-check.txt'
      // Check CORS for the site the person is adding the account from (their
      // copied rule names that origin), falling back to the live site.
      const origin = /^https?:\/\/[^\s/]+$/.test(c.cors_origin ?? '') ? c.cors_origin : SITE_ORIGIN
      const put = await fetch(await url(c, s, 'PUT', key), { method: 'PUT', body: 'ok' }).catch(() => null)
      if (!put) throw new AppError(`Could not reach ${name}. Check the account ID / endpoint.`, 400)
      if (put.status === 403 || put.status === 401) throw new AppError(`${name} rejected these keys. Check the access key has read and write permission for this bucket.`, 400)
      if (put.status === 404) throw new AppError(`${name} can’t find a bucket called “${c.bucket}”.`, 400)
      if (!put.ok) throw new AppError(`${name} refused the test upload (${put.status}).`, 400)

      try {
        const pub = await fetch(publicUrl(c, key)).catch(() => null)
        if (!pub?.ok) throw new AppError(`The keys work, but the bucket isn’t readable at its public URL. Turn on public access and check the URL.`, 400)
        await pub.body?.cancel()

        const pre = await fetch(`https://${target(c).host}/${c.bucket}/${key}`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
        }).catch(() => null)
        const allowed = pre?.headers.get('access-control-allow-origin')
        await pre?.body?.cancel()
        if (!allowed || (allowed !== '*' && allowed !== origin)) {
          throw new AppError(`The keys work, but the bucket doesn’t allow uploads from ${origin}. Add the CORS rule shown under “Where do I find these?”.`, 400)
        }
      } finally {
        await fetch(await url(c, s, 'DELETE', key), { method: 'DELETE' }).catch(() => {})
      }
      return { plan: name, storage_bytes: 0 }
    },

    signUpload: async (acc, s, base, type, filename) => {
      const key = `${base}.${extOf(filename, type)}`
      return {
        public_id: key,
        plan: {
          method: 'put',
          original: await url(acc.config, s, 'PUT', key),
          thumb: await url(acc.config, s, 'PUT', thumbKey(key)),
          ...(type === 'image' ? { full: await url(acc.config, s, 'PUT', fullKey(key)) } : {}),
        },
      }
    },

    confirm: async (acc, s, intent, r) => {
      const res = await head(acc.config, s, intent.public_id)
      if (res.status === 404) throw badRequest(`${name} doesn’t have this file. The upload may have failed — please try again.`)
      if (!res.ok) throw new AppError(`${name} error ${res.status}`, 502)
      const [t, f] = await Promise.all([
        head(acc.config, s, thumbKey(intent.public_id)),
        intent.resource_type === 'image' ? head(acc.config, s, fullKey(intent.public_id)) : Promise.resolve(null),
      ])
      return {
        public_id: intent.public_id,
        format: intent.public_id.split('.').pop() ?? null,
        bytes: Number(res.headers.get('content-length') ?? 0),
        // Dimensions come from the phone; only used for layout.
        width: Number(r.width) || null,
        height: Number(r.height) || null,
        duration: Number(r.duration) || null,
        has_thumb: t.ok,
        has_full: !!f?.ok,
      }
    },

    urls: (acc, m) => {
      const orig = publicUrl(acc.config, m.public_id)
      const thumb = m.has_thumb ? publicUrl(acc.config, thumbKey(m.public_id)) : m.resource_type === 'image' ? orig : ''
      return {
        thumb,
        full: m.has_full ? publicUrl(acc.config, fullKey(m.public_id)) : m.resource_type === 'image' ? orig : thumb,
        video: m.resource_type === 'video' ? orig : null,
        video_hd: null,
        download: orig,
      }
    },

    // Signed GET that tells the browser to save rather than open the file.
    downloadUrl: (acc, s, m) => url(acc.config, s, 'GET', m.public_id, {
      'response-content-disposition': `attachment; filename="turfball-${(m.id ?? 'file').slice(0, 8)}.${m.format ?? 'bin'}"`,
    }),

    destroy: async (acc, s, items) => {
      const keys = items.flatMap((m) => [m.public_id, thumbKey(m.public_id), ...(m.resource_type === 'image' ? [fullKey(m.public_id)] : [])])
      for (let i = 0; i < keys.length; i += 10) {
        const batch = await Promise.all(keys.slice(i, i + 10).map(async (k) => (await fetch(await url(acc.config, s, 'DELETE', k), { method: 'DELETE' }).catch(() => null))))
        // 404 means already gone — fine. Anything else stops the purge so rows aren't orphaned.
        const bad = batch.find((r) => !r || (!r.ok && r.status !== 404))
        batch.forEach((r) => r?.body?.cancel())
        if (bad !== undefined) throw new AppError(`${name} wouldn’t delete a file (${bad?.status ?? 'no response'})`, 502)
      }
    },

    usage: (_acc: AccountRow, _s: Secrets, storedBytes: number) => Promise.resolve({ plan: name, storage_bytes: storedBytes }),
  }
  return provider
}

const clean = (u: string | undefined) => (u ?? '').trim().replace(/\/+$/, '')

export const r2 = makeS3('r2', (c) => {
  if (!/^[a-f0-9]{32}$/i.test(c.account_id ?? '')) throw badRequest('Please check the highlighted fields', { account_id: ['Your Cloudflare account ID is 32 letters and numbers'] })
  return { host: `${c.account_id}.r2.cloudflarestorage.com`, region: 'auto', bucket: c.bucket, publicUrl: clean(c.public_url), keyId: c.access_key_id }
}, 'Cloudflare R2')

export const b2 = makeS3('b2', (c) => {
  const host = clean(c.endpoint).replace(/^https?:\/\//, '')
  const m = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(host)
  if (!m) throw badRequest('Please check the highlighted fields', { endpoint: ['Paste the bucket’s S3 endpoint, e.g. s3.us-west-004.backblazeb2.com'] })
  return { host, region: m[1], bucket: c.bucket, publicUrl: clean(c.public_url), keyId: c.access_key_id }
}, 'Backblaze B2')

export type { MediaRef }
