/**
 * Bunny.net Stream: videos only, pay-as-you-go (roughly a cent per GB), with
 * its own encoding into 360p–1080p and thumbnails.
 *
 * Upload uses Bunny's TUS endpoint with a presigned header:
 * sha256(library_id + api_key + expiry + video_id). The video object is
 * created on our server first, so the signature only works for that one id.
 *
 * Library settings needed: "MP4 fallback" on (we play plain MP4s) and
 * "Keep original files" on (for downloads). test() can't see those, so the
 * add-account help lists them.
 */

import { AppError, badRequest } from '../errors.ts'
import type { AccountRow, Provider, Secrets } from './types.ts'

const API = 'https://video.bunnycdn.com'

async function call<T>(s: Secrets, lib: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}/library/${lib}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), AccessKey: s.api_key, Accept: 'application/json' },
    })
  } catch {
    throw new AppError('Could not reach Bunny.net. Try again in a moment.', 502)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AppError('Bunny.net rejected this API key for that library.', 400)
    if (res.status === 404) throw new AppError('Not found on Bunny.net', 404)
    throw new AppError((body as { Message?: string }).Message ?? `Bunny.net error ${res.status}`, 502)
  }
  return body as T
}

async function sha256Hex(msg: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const cdn = (c: Record<string, string>) => (c.cdn_host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** Largest standard rendition that fits the video's shorter side. */
function rendition(w: number | null, h: number | null, cap: number): number {
  const short = Math.min(w || 720, h || 720)
  return [240, 360, 480, 720, 1080].filter((r) => r <= Math.min(short, cap)).pop() ?? 240
}

export const bunny: Provider = {
  id: 'bunny',
  kinds: ['video'],
  canCompress: false,
  canZip: false,
  configFields: ['library_id', 'cdn_host'],
  secretFields: ['api_key'],

  identify: (c) => {
    if (!/^\d+$/.test(c.library_id ?? '')) throw badRequest('Please check the highlighted fields', { library_id: ['The Video Library ID is a number'] })
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cdn(c))) throw badRequest('Please check the highlighted fields', { cdn_host: ['Paste the CDN hostname, e.g. vz-abc123-456.b-cdn.net'] })
    return { identifier: c.library_id, apiKey: c.library_id }
  },

  test: async (c, s) => {
    await call(s, c.library_id, '/videos?page=1&itemsPerPage=1')
    return { plan: 'Bunny Stream' }
  },

  signUpload: async (acc, s, base) => {
    const lib = acc.config.library_id
    const v = await call<{ guid: string }>(s, lib, '/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: base.split('/').pop() }),
    })
    const expire = Math.floor(Date.now() / 1000) + 3600
    return {
      public_id: v.guid,
      provider_file_id: v.guid,
      plan: {
        method: 'tus',
        endpoint: `${API}/tusupload`,
        headers: {
          AuthorizationSignature: await sha256Hex(`${lib}${s.api_key}${expire}${v.guid}`),
          AuthorizationExpire: String(expire),
          VideoId: v.guid,
          LibraryId: lib,
        },
      },
    }
  },

  confirm: async (acc, s, intent, r) => {
    const v = await call<{ length?: number; storageSize?: number; width?: number; height?: number; status?: number }>(s, acc.config.library_id, `/videos/${intent.public_id}`)
    // Status 5 = failed, 6 = upload failed.
    if (v.status === 5 || v.status === 6) throw badRequest('Bunny.net couldn’t process this video. Please try again.')
    return {
      public_id: intent.public_id,
      provider_file_id: intent.public_id,
      format: 'mp4',
      // Bunny fills storageSize in once encoding finishes; the phone's number until then.
      bytes: Number(v.storageSize) || Math.max(0, Number(r.bytes) || 0),
      width: v.width || Number(r.width) || null,
      height: v.height || Number(r.height) || null,
      duration: v.length || Number(r.duration) || null,
    }
  },

  urls: (acc, m) => {
    const host = `https://${cdn(acc.config)}/${m.public_id}`
    const sd = rendition(m.width, m.height, 720)
    const hd = rendition(m.width, m.height, 1080)
    return {
      thumb: `${host}/thumbnail.jpg`,
      full: `${host}/thumbnail.jpg`,
      video: `${host}/play_${sd}p.mp4`,
      video_hd: hd > sd ? `${host}/play_${hd}p.mp4` : null,
      download: `${host}/original`,
    }
  },

  downloadUrl: (acc, _s, m) => Promise.resolve(bunny.urls(acc, m).download),

  destroy: async (acc, s, items) => {
    for (const m of items) {
      await call(s, acc.config.library_id, `/videos/${m.public_id}`, { method: 'DELETE' }).catch((err) => {
        if (!(err instanceof AppError && err.status === 404)) throw err
      })
    }
  },

  usage: (_acc: AccountRow, _s: Secrets, storedBytes: number) => Promise.resolve({ plan: 'Bunny Stream', storage_bytes: storedBytes }),
}
