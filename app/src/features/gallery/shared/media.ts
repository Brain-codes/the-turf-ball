
import type { MediaBase } from '../types'

/*
 * The server builds every file's URLs for the provider that holds it
 * (Cloudinary, ImageKit, R2, B2, Bunny). These helpers just read them, so
 * screens never need to know which provider a file lives on.
 */

/** Grid tile, album cover, hero, share preview. */
export const thumbUrl = (m: MediaBase) => m.urls.thumb

/** Full-screen photo. */
export const fullUrl = (m: MediaBase) => m.urls.full

/** 720p data-saver playback by default; `hd` for full quality when the provider has one. */
export const videoUrl = (m: MediaBase, hd = false) => (hd && m.urls.video_hd) || m.urls.video || m.urls.download

export const posterUrl = (m: MediaBase) => m.urls.thumb || undefined

export const hasHd = (m: MediaBase) => !!m.urls.video_hd

export function aspect(m: MediaBase): number {
  return m.width && m.height ? m.width / m.height : 4 / 3
}

export function formatBytes(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0)
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = b / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

export function formatDuration(sec: number | null | undefined): string {
  const s = Math.round(Number(sec ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Kick off browser downloads for one or more links, spaced so none are blocked. */
export function startDownloads(links: { url: string }[]) {
  links.forEach((l, i) => {
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = l.url
      a.rel = 'noopener'
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
    }, i * 900)
  })
}
