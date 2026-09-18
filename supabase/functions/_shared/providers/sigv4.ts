/**
 * AWS Signature V4 presigned URLs — used by every S3-compatible provider
 * (Cloudflare R2, Backblaze B2). A presigned URL lets one specific request
 * (e.g. PUT this one object, for the next hour) happen without the secret.
 * The server also uses them for its own HEAD/DELETE calls, so there's one
 * signing path to get right. Checked against AWS's published test vector.
 */

const enc = new TextEncoder()

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}

async function sha256Hex(msg: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(msg)))
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** RFC 3986 encoding as S3 expects: only A-Z a-z 0-9 - _ . ~ left alone. */
export function uriEncode(s: string, keepSlash = false): string {
  return [...enc.encode(s)].map((b) => {
    const c = String.fromCharCode(b)
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/')) return c
    return '%' + b.toString(16).toUpperCase().padStart(2, '0')
  }).join('')
}

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'
  host: string
  /** Path starting with '/', unencoded. */
  path: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  expires?: number
  /** Extra signed query params, e.g. response-content-disposition. */
  query?: Record<string, string>
  /** Override for tests. */
  date?: Date
}

export async function presign(i: PresignInput): Promise<string> {
  const d = i.date ?? new Date()
  const amzDate = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${i.region}/s3/aws4_request`

  const q: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(i.expires ?? 3600),
    'X-Amz-SignedHeaders': 'host',
    ...(i.query ?? {}),
  }
  const query = Object.keys(q).sort().map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`).join('&')
  const path = uriEncode(i.path, true)

  const canonical = [i.method, path, query, `host:${i.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n')

  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${i.secretAccessKey}`), day)
  key = await hmac(key, i.region)
  key = await hmac(key, 's3')
  key = await hmac(key, 'aws4_request')
  const signature = hex(await hmac(key, toSign))

  return `https://${i.host}${path}?${query}&X-Amz-Signature=${signature}`
}
