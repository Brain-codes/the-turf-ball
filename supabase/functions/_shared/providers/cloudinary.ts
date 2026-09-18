/**
 * Cloudinary: photos and videos, resized on the fly, 25 free credits a month
 * (storage + views + edits). The only provider with a real plan-usage API,
 * server-side compression and one-zip downloads.
 */

import {
  archiveUrl as zipUrl,
  destroyMany,
  getResource,
  getUsage,
  signedUpload,
  verifyUploadSignature,
  type Creds,
  type Usage,
} from '../cloudinary.ts'
import { AppError, badRequest } from '../errors.ts'
import type { AccountRow, Provider, Secrets, UsageSnapshot } from './types.ts'

export const creds = (acc: Pick<AccountRow, 'cloud_name' | 'api_key'>, s: Secrets): Creds => ({
  cloud: acc.cloud_name,
  key: acc.api_key,
  secret: s.api_secret,
})

const snapshot = (u: Usage): UsageSnapshot => ({
  plan: u.plan ?? null,
  usage_pct: u.credits?.used_percent ?? null,
  credits_used: u.credits?.usage ?? null,
  credits_limit: u.credits?.limit ?? null,
  storage_bytes: u.storage?.usage ?? null,
  bandwidth_bytes: u.bandwidth?.usage ?? null,
  transformations: u.transformations?.usage ?? null,
  resources: u.resources ?? null,
})

// Two sizes per file, everywhere: each new size is a paid transformation.
const THUMB = 'c_limit,w_640,q_auto,f_auto'
const FULL = 'c_limit,w_2000,q_auto,f_auto'

export const cloudinary: Provider = {
  id: 'cloudinary',
  kinds: ['image', 'video'],
  canCompress: true,
  canZip: true,
  configFields: ['cloud_name', 'api_key'],
  secretFields: ['api_secret'],

  identify: (c) => {
    if (!/^[a-z0-9_-]+$/i.test(c.cloud_name ?? '')) throw badRequest('Please check the highlighted fields', { cloud_name: ['That doesn’t look like a Cloudinary cloud name'] })
    return { identifier: c.cloud_name, apiKey: c.api_key }
  },

  test: async (c, s) => snapshot(await getUsage({ cloud: c.cloud_name, key: c.api_key, secret: s.api_secret })),

  signUpload: async (acc, s, base, type) => {
    const signed = await signedUpload(creds(acc, s), base, type)
    return { public_id: base, plan: { method: 'form', upload_url: signed.upload_url, fields: signed.fields, chunked: true } }
  },

  confirm: async (acc, s, intent, r) => {
    const c = creds(acc, s)
    // Cloudinary's signed receipt proves the upload without an Admin API
    // call (500/hour on the free plan). If it doesn't verify, ask directly.
    if (typeof r.signature === 'string' && r.version != null && r.public_id === intent.public_id &&
      await verifyUploadSignature(c, intent.public_id, String(r.version), r.signature)) {
      return {
        public_id: intent.public_id,
        format: String(r.format ?? '') || null,
        bytes: Math.max(0, Number(r.bytes) || 0),
        width: Number(r.width) || null,
        height: Number(r.height) || null,
        duration: Number(r.duration) || null,
        version: Number(r.version),
      }
    }
    const res = await getResource(c, intent.resource_type, intent.public_id).catch((err) => {
      if (err instanceof AppError && err.status === 404) throw badRequest('Cloudinary doesn’t have this file. The upload may have failed — please try again.')
      throw err
    })
    return { public_id: res.public_id, format: res.format, bytes: res.bytes, width: res.width, height: res.height, duration: res.duration, version: res.version }
  },

  urls: (acc, m) => {
    const base = `https://res.cloudinary.com/${acc.cloud_name}/${m.resource_type}/upload`
    const v = m.version ? `v${m.version}/` : ''
    if (m.resource_type === 'video') {
      return {
        thumb: `${base}/so_1,${THUMB}/${v}${m.public_id}.jpg`,
        full: `${base}/so_1,${FULL}/${v}${m.public_id}.jpg`,
        // 720p by default (longest side 1280); HD made only when asked for.
        video: `${base}/c_limit,w_1280,h_1280,q_auto,vc_auto/${v}${m.public_id}.mp4`,
        video_hd: `${base}/c_limit,w_1920,h_1920,q_auto,vc_auto/${v}${m.public_id}.mp4`,
        download: `${base}/fl_attachment/${v}${m.public_id}.${m.format ?? 'mp4'}`,
      }
    }
    return {
      thumb: `${base}/${THUMB}/${v}${m.public_id}`,
      full: `${base}/${FULL}/${v}${m.public_id}`,
      video: null,
      video_hd: null,
      // Plain fl_attachment: one cached copy, not a new transformation per download.
      download: `${base}/fl_attachment/${v}${m.public_id}.${m.format ?? 'jpg'}`,
    }
  },

  downloadUrl: (acc, _s, m) => Promise.resolve(cloudinary.urls(acc, m).download),

  destroy: async (acc, s, items) => {
    const c = creds(acc, s)
    for (const type of ['image', 'video'] as const) {
      const ids = items.filter((i) => i.resource_type === type).map((i) => i.public_id)
      if (ids.length) await destroyMany(c, type, ids)
    }
  },

  usage: async (acc, s) => snapshot(await getUsage(creds(acc, s))),
}

export { zipUrl }
