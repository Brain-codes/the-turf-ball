/**
 * What every storage provider has to do for the gallery. Adding a provider
 * means implementing this once; the handlers never branch on provider names.
 */

export type ResourceType = 'image' | 'video'
export type ProviderId = 'cloudinary' | 'imagekit' | 'r2' | 'b2' | 'bunny'

export interface AccountRow {
  id: string
  organization_id: string
  provider: ProviderId
  label: string
  /** The provider's identifier: cloud name, ImageKit id, bucket, library id. */
  cloud_name: string
  api_key: string
  config: Record<string, string>
  secret_ciphertext: string
  secret_iv: string
  position: number
  enabled: boolean
  kinds: ResourceType[]
  threshold_pct: number
  usage_pct: number | null
  credits_used: number | null
  credits_limit: number | null
  storage_bytes: number | null
  bandwidth_bytes: number | null
  storage_limit_bytes: number | null
  bandwidth_limit_bytes: number | null
  pending_bytes: number
  last_checked_at: string | null
  last_error: string | null
}

export type Secrets = Record<string, string>

/** A stored file, as much as a provider needs to build its URLs or delete it. */
export interface MediaRef {
  id?: string
  public_id: string
  provider_file_id: string | null
  resource_type: ResourceType
  format: string | null
  version: number | null
  width: number | null
  height: number | null
  has_thumb: boolean
  has_full: boolean
}

export interface MediaUrls {
  /** Grid tile, album cover, 3D hero, video poster. May be '' if none yet. */
  thumb: string
  /** Full-screen photo. */
  full: string
  /** Default playback (data saver where the provider can resize). */
  video: string | null
  /** Full quality, when it differs from `video`. */
  video_hd: string | null
  /** Direct download of the original. */
  download: string
}

/** How the browser should send the file. Never contains a secret. */
export type UploadPlan =
  | { method: 'form'; upload_url: string; fields: Record<string, string | number>; chunked: boolean }
  | { method: 'put'; original: string; thumb?: string; full?: string }
  | { method: 'tus'; endpoint: string; headers: Record<string, string> }

export interface SignedUpload {
  plan: UploadPlan
  public_id: string
  provider_file_id?: string
}

/** What the browser reports back after uploading. Only trusted once verified. */
export type Receipt = Record<string, unknown>

export interface FileInfo {
  public_id: string
  provider_file_id?: string | null
  format: string | null
  bytes: number
  width?: number | null
  height?: number | null
  duration?: number | null
  version?: number | null
  has_thumb?: boolean
  has_full?: boolean
}

export type AccountStatus = 'active' | 'standby' | 'filling' | 'full' | 'disabled' | 'error'

export interface UsageSnapshot {
  plan?: string | null
  usage_pct?: number | null
  credits_used?: number | null
  credits_limit?: number | null
  storage_bytes?: number | null
  bandwidth_bytes?: number | null
  transformations?: number | null
  resources?: number | null
}

export interface Intent {
  public_id: string
  provider_file_id: string | null
  resource_type: ResourceType
}

export interface Provider {
  id: ProviderId
  /** What it can store. */
  kinds: ResourceType[]
  /** Server-side re-encode to save space. */
  canCompress: boolean
  /** Can hand back one zip for many files. */
  canZip: boolean
  /** Required non-secret settings and secrets, for validation. */
  configFields: string[]
  secretFields: string[]
  /** Pull the identifier + display key out of the settings. */
  identify(config: Record<string, string>): { identifier: string; apiKey: string }
  /** Prove the keys work (and anything else we can check). Returns first usage numbers. */
  test(config: Record<string, string>, secrets: Secrets): Promise<UsageSnapshot>
  signUpload(acc: AccountRow, secrets: Secrets, base: string, type: ResourceType, filename: string): Promise<SignedUpload>
  confirm(acc: AccountRow, secrets: Secrets, intent: Intent, receipt: Receipt): Promise<FileInfo>
  urls(acc: Pick<AccountRow, 'provider' | 'cloud_name' | 'config'>, m: MediaRef): MediaUrls
  /** A download link for one file (may be signed and short-lived). */
  downloadUrl(acc: AccountRow, secrets: Secrets, m: MediaRef): Promise<string>
  destroy(acc: AccountRow, secrets: Secrets, items: MediaRef[]): Promise<void>
  usage(acc: AccountRow, secrets: Secrets, storedBytes: number): Promise<UsageSnapshot>
}

export const extOf = (filename: string, type: ResourceType) => {
  const e = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  return e && e.length <= 5 ? e : type === 'video' ? 'mp4' : 'jpg'
}
