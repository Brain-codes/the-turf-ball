/**
 * Getting one file from the phone to whichever storage the server picked.
 * The server's "plan" says how; nothing here holds a secret.
 *
 * - form: multipart POST (Cloudinary — in 10 MB pieces for big files — and ImageKit)
 * - put:  presigned PUTs (Cloudflare R2, Backblaze B2). These can't resize, so
 *         the phone makes the 640px grid image and 2000px full-screen copy
 *         itself (or a poster frame for a video) and uploads them alongside.
 * - tus:  resumable upload (Bunny.net Stream, videos only)
 *
 * Every method returns a "receipt" the server verifies before saving.
 */

import { ApiError } from '@/services/client'
import type { ResourceType } from '../types'

export type UploadPlan =
  | { method: 'form'; upload_url: string; fields: Record<string, string | number>; chunked: boolean }
  | { method: 'put'; original: string; thumb?: string; full?: string }
  | { method: 'tus'; endpoint: string; headers: Record<string, string> }

export type Receipt = Record<string, unknown>

const CHUNK = 10 * 1024 * 1024
const CHUNK_THRESHOLD = 20 * 1024 * 1024

/** Open requests per upload, so Cancel can abort them. */
export const active = new Map<string, XMLHttpRequest>()

export async function sendFile(
  itemId: string,
  plan: UploadPlan,
  file: Blob,
  name: string,
  type: ResourceType,
  onProgress: (p: number) => void,
): Promise<Receipt> {
  if (plan.method === 'form') return sendForm(itemId, plan, file, name, onProgress)
  if (plan.method === 'put') return sendPut(itemId, plan, file, type, onProgress)
  return sendTus(itemId, plan, file, name, type, onProgress)
}

/* ------------------------------------------------------------------ form */

async function sendForm(itemId: string, plan: Extract<UploadPlan, { method: 'form' }>, file: Blob, name: string, onProgress: (p: number) => void) {
  const post = (blob: Blob, headers: Record<string, string>, progress: (loaded: number) => void) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(plan.fields)) form.append(k, String(v))
    form.append('file', blob, name)
    return xhr(itemId, 'POST', plan.upload_url, form, headers, progress)
  }

  if (!plan.chunked || file.size <= CHUNK_THRESHOLD) {
    return parse(await post(file, {}, (l) => onProgress(l / file.size)))
  }
  // Cloudinary chunked upload: same signed fields on every piece, tied together by an id.
  const uploadId = crypto.randomUUID()
  let last: XMLHttpRequest | null = null
  for (let start = 0; start < file.size; start += CHUNK) {
    const end = Math.min(start + CHUNK, file.size)
    last = await post(
      file.slice(start, end),
      { 'X-Unique-Upload-Id': uploadId, 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
      (l) => onProgress((start + l) / file.size),
    )
  }
  // The last piece's response describes the whole file.
  return parse(last!)
}

/* ------------------------------------------------------------------- put */

async function sendPut(itemId: string, plan: Extract<UploadPlan, { method: 'put' }>, file: Blob, type: ResourceType, onProgress: (p: number) => void) {
  const probe = await measure(file, type)
  // Small copies first: they're quick, and the grid needs them.
  if (plan.thumb && probe.frame) {
    const thumb = await resize(probe.frame, 640)
    if (thumb) await xhr(itemId, 'PUT', plan.thumb, thumb, { 'Content-Type': 'image/jpeg' }, () => {})
  }
  if (plan.full && probe.frame) {
    const full = await resize(probe.frame, 2000)
    if (full) await xhr(itemId, 'PUT', plan.full, full, { 'Content-Type': 'image/jpeg' }, () => {})
  }
  probe.frame?.close?.()
  await xhr(itemId, 'PUT', plan.original, file, { 'Content-Type': file.type || 'application/octet-stream' }, (l) => onProgress(l / file.size))
  return { width: probe.width, height: probe.height, duration: probe.duration, bytes: file.size }
}

/* ------------------------------------------------------------------- tus */

async function sendTus(itemId: string, plan: Extract<UploadPlan, { method: 'tus' }>, file: Blob, name: string, type: ResourceType, onProgress: (p: number) => void) {
  const probe = await measure(file, type)
  probe.frame?.close?.()
  const meta = `filetype ${btoa(file.type || 'video/mp4')},title ${btoa(unescape(encodeURIComponent(name)))}`

  const create = await xhr(itemId, 'POST', plan.endpoint, null, {
    ...plan.headers,
    'Tus-Resumable': '1.0.0',
    'Upload-Length': String(file.size),
    'Upload-Metadata': meta,
  }, () => {})
  const location = create.getResponseHeader('Location')
  if (!location) throw new ApiError('The video service didn’t accept the upload. Try again.', create.status)
  const url = new URL(location, plan.endpoint).toString()

  for (let offset = 0; offset < file.size;) {
    const end = Math.min(offset + CHUNK, file.size)
    const res = await xhr(itemId, 'PATCH', url, file.slice(offset, end), {
      ...plan.headers,
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': String(offset),
      'Content-Type': 'application/offset+octet-stream',
    }, (l) => onProgress((offset + l) / file.size))
    offset = Number(res.getResponseHeader('Upload-Offset') ?? end)
  }
  return { width: probe.width, height: probe.height, duration: probe.duration, bytes: file.size }
}

/* --------------------------------------------------------------- helpers */

function xhr(
  itemId: string,
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit | null,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    active.set(itemId, x)
    x.open(method, url)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded)
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve(x)
      let message = `Upload failed (${x.status})`
      try {
        const b = JSON.parse(x.responseText)
        message = b?.error?.message ?? b?.message ?? message
      } catch { /* not JSON */ }
      if (/file size too large|too large/i.test(message)) message = 'Too big for this storage plan. Try a shorter clip, or trim it first.'
      if (x.status === 403 && method === 'PUT') message = 'The storage refused the upload. Ask your admin to check its CORS and key permissions.'
      reject(new ApiError(message, x.status))
    }
    // Blocked by CORS shows up here too, with no status to go on.
    x.onerror = () => reject(new ApiError('Connection dropped, or the storage blocked the upload. Tap retry.', 0))
    x.onabort = () => reject(new ApiError('Cancelled', 0))
    x.send(body)
  })
}

function parse(x: XMLHttpRequest): Receipt {
  try {
    return JSON.parse(x.responseText)
  } catch {
    return {}
  }
}

interface Probe {
  width: number | null
  height: number | null
  duration: number | null
  /** A drawable frame: the photo itself, or a video's frame at ~1s. */
  frame: (ImageBitmap & { close?: () => void }) | null
}

/** Size (and length) of a file, plus one frame to make thumbnails from. */
async function measure(file: Blob, type: ResourceType): Promise<Probe> {
  if (type === 'image') {
    try {
      const b = await createImageBitmap(file)
      return { width: b.width, height: b.height, duration: null, frame: b }
    } catch {
      return { width: null, height: null, duration: null, frame: null } // e.g. HEIC outside Safari
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    await new Promise<void>((ok, bad) => {
      v.onloadedmetadata = () => ok()
      v.onerror = () => bad(new Error('unreadable'))
    })
    const out: Probe = { width: v.videoWidth || null, height: v.videoHeight || null, duration: Number.isFinite(v.duration) ? v.duration : null, frame: null }
    v.currentTime = Math.min(1, (v.duration || 2) / 2)
    await new Promise<void>((ok) => {
      v.onseeked = () => ok()
      setTimeout(ok, 4000)
    })
    out.frame = await createImageBitmap(v).catch(() => null)
    return out
  } catch {
    return { width: null, height: null, duration: null, frame: null }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function resize(frame: ImageBitmap, max: number): Promise<Blob | null> {
  const scale = Math.min(1, max / Math.max(frame.width, frame.height))
  const c = document.createElement('canvas')
  c.width = Math.round(frame.width * scale)
  c.height = Math.round(frame.height * scale)
  c.getContext('2d')!.drawImage(frame, 0, 0, c.width, c.height)
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))
}
