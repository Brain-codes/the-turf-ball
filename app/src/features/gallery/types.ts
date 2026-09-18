export type ResourceType = 'image' | 'video'
export type ProviderId = 'cloudinary' | 'imagekit' | 'r2' | 'b2' | 'bunny'

/** Built by the server for whichever provider holds the file. */
export interface MediaUrls {
  thumb: string
  full: string
  video: string | null
  video_hd: string | null
  download: string
}

/** Fields every gallery item carries, public or team-side. */
export interface MediaBase {
  id: string
  album_id: string | null
  resource_type: ResourceType
  format: string | null
  width: number | null
  height: number | null
  duration: number | null
  urls: MediaUrls
  title: string | null
  favourite_count: number
  created_at: string
}

export interface TeamMedia extends MediaBase {
  bytes: number
  provider: ProviderId
  original_filename: string | null
  download_count: number
  compressed: boolean
  deleted_at: string | null
  purge_at: string | null
  uploaded_by: string | null
  uploader: { id: string; name: string | null } | null
  mine: boolean
}

export interface Album {
  id: string
  title: string
  description: string | null
  visibility: 'public' | 'private'
  event_date: string | null
  created_by?: string | null
  cover_media_id?: string | null
  cover: MediaBase | null
  photos: number
  videos: number
}

export type AccountStatus = 'active' | 'standby' | 'filling' | 'full' | 'disabled' | 'error'

export interface StorageAccount {
  id: string
  provider: ProviderId
  provider_name: string
  config: Record<string, string>
  kinds: ResourceType[]
  storage_limit_bytes: number | null
  bandwidth_limit_bytes: number | null
  label: string
  cloud_name: string
  api_key: string
  secret_last4: string
  position: number
  enabled: boolean
  threshold_pct: number
  usage_pct: number | null
  effective_pct: number
  credits_used: number | null
  credits_limit: number | null
  storage_bytes: number | null
  bandwidth_bytes: number | null
  transformations: number | null
  resources: number | null
  plan: string | null
  last_checked_at: string | null
  last_error: string | null
  status: AccountStatus
  taking_uploads: boolean
  /** Which kinds this account is receiving right now. */
  takes: ResourceType[]
  files: number
  file_bytes: number
  images: number
  videos: number
  trashed: number
}

export interface StorageView {
  organization: { id: string; name: string; slug: string; logo_url: string | null; gallery_enabled: boolean }
  can_manage: boolean
  super_admin: boolean
  accounts: StorageAccount[]
  totals: {
    accounts: number
    files: number
    bytes: number
    images: number
    videos: number
    trash_files: number
    trash_bytes: number
    next_purge_at: string | null
  }
}

export interface DownloadLink {
  url: string
  label: string
}
