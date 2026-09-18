/**
 * Upload queue. Files go from the browser straight to the team's storage
 * (Cloudinary, ImageKit, R2, B2 or Bunny) — never through our servers — using
 * a one-file pass from /gallery/uploads/sign. See transport.ts.
 * Then /gallery/uploads/confirm checks the file really landed before it
 * appears in the gallery.
 *
 * - Three files upload at once; the rest wait their turn.
 * - Files over 20 MB go up in 10 MB pieces, so a dropped signal only costs
 *   the current piece, and big match videos don't hit request size limits.
 * - "Save space" (on by default) shrinks photos on the phone first. A 6 MB
 *   camera photo usually ends up around 1 MB with no visible difference.
 */

import { create } from 'zustand'
import { api } from '@/services/client'
import type { ResourceType, TeamMedia } from '../types'
import { active, sendFile, type UploadPlan } from './transport'

export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'saving' | 'done' | 'error' | 'cancelled'

export interface UploadItem {
  id: string
  file: File
  name: string
  type: ResourceType
  size: number
  albumId: string | null
  progress: number
  status: UploadStatus
  error?: string
  result?: TeamMedia
}

interface SignResponse {
  intent_id: string
  provider: string
  plan: UploadPlan
}

// Cloudinary free-plan limits. Checked on the phone so nobody waits minutes
// for an upload Cloudinary was always going to refuse.
const MAX_IMAGE = 10 * 1024 * 1024
const MAX_VIDEO = 100 * 1024 * 1024

const CONCURRENCY = 3

interface UploadState {
  items: UploadItem[]
  saveSpace: boolean
  onDone?: () => void
  setSaveSpace: (v: boolean) => void
  setOnDone: (fn: () => void) => void
  add: (files: File[], albumId: string | null) => { name: string; reason: string }[]
  cancel: (id: string) => void
  retry: (id: string) => void
  clearFinished: () => void
}

export function typeOf(file: File): ResourceType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext)) return 'video'
  return null
}

export const useUploads = create<UploadState>((set, get) => {
  const patch = (id: string, p: Partial<UploadItem>) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }))

  const pump = () => {
    const { items } = get()
    const running = items.filter((i) => ['preparing', 'uploading', 'saving'].includes(i.status)).length
    const next = items.filter((i) => i.status === 'queued').slice(0, Math.max(0, CONCURRENCY - running))
    for (const item of next) void run(item)
  }

  const run = async (item: UploadItem) => {
    patch(item.id, { status: 'preparing', progress: 0, error: undefined })
    try {
      let file: Blob = item.file
      if (item.type === 'image' && get().saveSpace) file = await shrinkPhoto(item.file)
      if (isCancelled(item.id)) return

      const { data: sign } = await api.post<SignResponse>('gallery/uploads/sign', {
        resource_type: item.type,
        album_id: item.albumId,
        filename: item.name,
      })
      if (isCancelled(item.id)) return

      if (item.type === 'image' && file.size > MAX_IMAGE) throw new Error('Photo is over 10 MB even after shrinking')

      patch(item.id, { status: 'uploading' })
      const upload = await sendFile(item.id, sign.plan, file, item.name, item.type, (p) => patch(item.id, { progress: p }))
      if (isCancelled(item.id)) return

      patch(item.id, { status: 'saving', progress: 1 })
      const { data } = await api.post<TeamMedia>('gallery/uploads/confirm', {
        intent_id: sign.intent_id,
        filename: item.name,
        // The provider's receipt — the server verifies it (signature, lookup
        // or HEAD) before the file appears in the gallery.
        upload,
      })
      patch(item.id, { status: 'done', result: data })
      get().onDone?.()
    } catch (err) {
      if (isCancelled(item.id)) return
      patch(item.id, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      active.delete(item.id)
      pump()
    }
  }

  const isCancelled = (id: string) => get().items.find((i) => i.id === id)?.status === 'cancelled'

  return {
    items: [],
    saveSpace: true,
    setSaveSpace: (v) => set({ saveSpace: v }),
    setOnDone: (fn) => set({ onDone: fn }),
    add: (files, albumId) => {
      const added: UploadItem[] = []
      const rejected: { name: string; reason: string }[] = []
      for (const file of files) {
        const type = typeOf(file)
        if (!type) {
          rejected.push({ name: file.name, reason: 'not a photo or video' })
          continue
        }
        if (type === 'video' && file.size > MAX_VIDEO) {
          rejected.push({ name: file.name, reason: 'videos must be under 100 MB — trim it or send a shorter clip' })
          continue
        }
        if (type === 'image' && file.size > MAX_IMAGE && !(get().saveSpace && SHRINKABLE.includes(file.type))) {
          rejected.push({ name: file.name, reason: 'photos must be under 10 MB' })
          continue
        }
        added.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          type,
          size: file.size,
          albumId,
          progress: 0,
          status: 'queued',
        })
      }
      set((s) => ({ items: [...s.items, ...added] }))
      pump()
      return rejected
    },
    cancel: (id) => {
      active.get(id)?.abort()
      active.delete(id)
      patch(id, { status: 'cancelled' })
      pump()
    },
    retry: (id) => {
      patch(id, { status: 'queued', progress: 0, error: undefined })
      pump()
    },
    clearFinished: () => set((s) => ({ items: s.items.filter((i) => !['done', 'cancelled'].includes(i.status)) })),
  }
})

/* ------------------------------------------------------------------ photos */

const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp']

/** Resize to 3200px on the long edge and re-encode. Keeps the original if that isn't smaller. */
async function shrinkPhoto(file: File): Promise<Blob> {
  if (!SHRINKABLE.includes(file.type) || file.size < 1.2 * 1024 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    return out && out.size < file.size ? out : file
  } catch {
    return file
  }
}
