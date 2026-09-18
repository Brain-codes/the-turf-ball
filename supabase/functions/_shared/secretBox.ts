/**
 * Encryption for third-party secrets we must store (Cloudinary API secrets).
 *
 * AES-256-GCM with a random 96-bit IV per value. The key comes from the
 * GALLERY_ENCRYPTION_KEY env var (32 random bytes, base64) and never touches
 * the database, so a leaked database dump is useless on its own. GCM also
 * authenticates: a tampered ciphertext fails to decrypt rather than yielding
 * garbage.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

let cachedKey: Promise<CryptoKey> | null = null

function key(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const raw = Deno.env.get('GALLERY_ENCRYPTION_KEY')
  if (!raw) throw new Error('GALLERY_ENCRYPTION_KEY is not set')
  const bytes = b64decode(raw)
  if (bytes.byteLength !== 32) throw new Error('GALLERY_ENCRYPTION_KEY must be 32 bytes (base64)')
  cachedKey = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return cachedKey
}

export async function sealSecret(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(plain))
  return { ciphertext: b64encode(new Uint8Array(out)), iv: b64encode(iv) }
}

export async function openSecret(ciphertext: string, iv: string): Promise<string> {
  const out = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(iv) },
    await key(),
    b64decode(ciphertext),
  )
  return dec.decode(out)
}

/** Constant-time comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
