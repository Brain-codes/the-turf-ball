/**
 * Player photo uploads. rule2.txt: clients never touch Storage directly.
 * The client sends a data URL (base64) in a normal JSON body to a normal
 * Edge Function; the function decodes it and writes through the
 * service-role client, exactly like every other write in this project.
 * The `player-photos` bucket (migration 20260816170000) is public-READ
 * only — there are no client-facing Storage policies at all.
 */

import type { SupabaseClient } from './db.ts'
import { badRequest } from './errors.ts'

const MAX_BYTES = 5 * 1024 * 1024
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * `dataUrl` looks like `data:image/jpeg;base64,/9j/4AAQ...`.
 * Returns the public URL of the uploaded object, scoped under the
 * organization's id so photos from different groups never collide.
 */
export async function uploadPlayerPhoto(
  db: SupabaseClient,
  organizationId: string,
  dataUrl: string,
): Promise<string> {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
  if (!match) throw badRequest('Photo must be a JPEG, PNG or WebP image')

  const [, mime, base64] = match
  const ext = MIME_EXT[mime]

  let bytes: Uint8Array
  try {
    const binary = atob(base64)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } catch {
    throw badRequest('That photo could not be read')
  }

  if (bytes.byteLength > MAX_BYTES) throw badRequest('Photos must be under 5MB')

  const path = `${organizationId}/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from('player-photos').upload(path, bytes, {
    contentType: mime,
    upsert: false,
  })
  if (error) throw new Error(error.message)

  const { data } = db.storage.from('player-photos').getPublicUrl(path)
  return data.publicUrl
}
