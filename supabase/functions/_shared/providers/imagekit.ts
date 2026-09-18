/**
 * ImageKit: photos and videos, resized on the fly like Cloudinary. The free
 * plan counts storage and bandwidth separately; its usage API reports what
 * was used but not the plan's size, so the team enters the limits.
 *
 * Uploads use ImageKit's one-time token signature (HMAC-SHA1 of token+expiry
 * with the private key). The token isn't bound to a file name, so confirm()
 * checks the file landed exactly where we said and deletes it otherwise.
 */

import { AppError, badRequest } from '../errors.ts'
import type { Provider, Secrets, UsageSnapshot } from './types.ts'
import { extOf } from './types.ts'

const API = 'https://api.imagekit.io/v1'

async function hmacSha1Hex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function call<T>(s: Secrets, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Basic ${btoa(`${s.private_key}:`)}` },
    })
  } catch {
    throw new AppError('Could not reach ImageKit. Try again in a moment.', 502)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AppError('ImageKit rejected this private key.', 400)
    if (res.status === 404) throw new AppError('Not found on ImageKit', 404)
    if (res.status === 429) throw new AppError('ImageKit is rate-limiting this account. Try again shortly.', 429)
    throw new AppError((body as { message?: string }).message ?? `ImageKit error ${res.status}`, 502)
  }
  return body as T
}

const day = (d: Date) => d.toISOString().slice(0, 10)

async function usage(s: Secrets): Promise<UsageSnapshot> {
  const end = new Date()
  const start = new Date(Date.now() - 29 * 86400_000)
  const u = await call<{ bandwidthBytes?: number; mediaLibraryStorageBytes?: number }>(s, `/accounts/usage?startDate=${day(start)}&endDate=${day(end)}`)
  return { storage_bytes: u.mediaLibraryStorageBytes ?? null, bandwidth_bytes: u.bandwidthBytes ?? null, plan: 'ImageKit' }
}

const endpoint = (c: Record<string, string>) => (c.url_endpoint ?? '').replace(/\/+$/, '')

export const imagekit: Provider = {
  id: 'imagekit',
  kinds: ['image', 'video'],
  canCompress: false,
  canZip: false,
  configFields: ['url_endpoint', 'public_key'],
  secretFields: ['private_key'],

  identify: (c) => {
    const m = /^https:\/\/ik\.imagekit\.io\/([a-z0-9_-]+)$/i.exec(endpoint(c)) ?? /^https:\/\/([a-z0-9.-]+)$/i.exec(endpoint(c))
    if (!m) throw badRequest('Please check the highlighted fields', { url_endpoint: ['Paste the URL endpoint, e.g. https://ik.imagekit.io/your_id'] })
    return { identifier: m[1], apiKey: c.public_key }
  },

  test: (_c, s) => usage(s),

  signUpload: async (acc, s, base, type, filename) => {
    const token = crypto.randomUUID()
    const expire = Math.floor(Date.now() / 1000) + 3000
    const signature = await hmacSha1Hex(s.private_key, `${token}${expire}`)
    const folder = `/${base.split('/').slice(0, -1).join('/')}`
    const fileName = `${base.split('/').pop()}.${extOf(filename, type)}`
    return {
      public_id: `${folder}/${fileName}`,
      plan: {
        method: 'form',
        upload_url: 'https://upload.imagekit.io/api/v1/files/upload',
        fields: { publicKey: acc.api_key, token, expire, signature, folder, fileName, useUniqueFileName: 'false', overwriteFile: 'false' },
        chunked: false,
      },
    }
  },

  confirm: async (_acc, s, intent, r) => {
    const fileId = typeof r.fileId === 'string' ? r.fileId : ''
    if (!fileId) throw badRequest('ImageKit didn’t confirm the upload. Please try again.')
    const d = await call<{ filePath: string; size: number; width?: number; height?: number; fileType?: string; name: string; duration?: number }>(s, `/files/${encodeURIComponent(fileId)}/details`)
    if (d.filePath !== intent.public_id) {
      // Uploaded somewhere we didn't sign for — remove it.
      await call(s, `/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => {})
      throw badRequest('That upload went to the wrong place and was removed. Please try again.')
    }
    return {
      public_id: d.filePath,
      provider_file_id: fileId,
      format: d.name.split('.').pop() ?? null,
      bytes: d.size,
      width: d.width ?? null,
      height: d.height ?? null,
      duration: d.duration ?? (Number(r.duration) || null),
    }
  },

  urls: (acc, m) => {
    const ep = endpoint(acc.config)
    const path = m.public_id.startsWith('/') ? m.public_id : `/${m.public_id}`
    if (m.resource_type === 'video') {
      return {
        thumb: `${ep}${path}/ik-thumbnail.jpg?tr=w-640`,
        full: `${ep}${path}/ik-thumbnail.jpg?tr=w-2000`,
        video: `${ep}/tr:w-1280,h-1280,c-at_max${path}`,
        video_hd: `${ep}${path}`,
        download: `${ep}${path}?ik-attachment=true`,
      }
    }
    return {
      thumb: `${ep}/tr:w-640,c-at_max${path}`,
      full: `${ep}/tr:w-2000,c-at_max${path}`,
      video: null,
      video_hd: null,
      download: `${ep}${path}?ik-attachment=true`,
    }
  },

  downloadUrl: (acc, _s, m) => Promise.resolve(imagekit.urls(acc, m).download),

  destroy: async (_acc, s, items) => {
    const ids = items.map((i) => i.provider_file_id).filter((x): x is string => !!x)
    for (let i = 0; i < ids.length; i += 100) {
      await call(s, '/files/batch/deleteByFileIds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: ids.slice(i, i + 100) }),
      })
    }
  },

  usage: (_acc, s) => usage(s),
}
