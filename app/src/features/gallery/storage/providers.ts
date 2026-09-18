/**
 * What the add-account screen shows for each storage provider: a short
 * pitch, the fields to fill in, and plain-English setup steps. The server
 * checks every key before saving, so these steps are guidance, not trust.
 */

import type { ProviderId, ResourceType } from '../types'

export interface ProviderField {
  key: string
  label: string
  secret?: boolean
  hint?: string
  placeholder?: string
  numeric?: boolean
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  tagline: string
  free: string
  kinds: ResourceType[]
  fields: ProviderField[]
  /** Offer storage/bandwidth limit boxes (providers that don't report their plan size). */
  limits: { storage: number | null; bandwidth: number | null } | null
  steps: string[]
  /** Settings to paste into the provider, e.g. a CORS rule. */
  snippet?: (origin: string) => { title: string; body: string }
}

const corsJson = (origin: string) => JSON.stringify([{
  AllowedOrigins: [origin],
  AllowedMethods: ['PUT', 'GET', 'HEAD'],
  AllowedHeaders: ['*'],
  MaxAgeSeconds: 3600,
}], null, 2)

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    tagline: 'Photos and videos. Resizes and compresses for you, plays videos at 720p to save data.',
    free: '25 credits a month free',
    kinds: ['image', 'video'],
    fields: [
      { key: 'cloud_name', label: 'Cloud name' },
      { key: 'api_key', label: 'API key', numeric: true },
      { key: 'api_secret', label: 'API secret', secret: true },
    ],
    limits: null,
    steps: [
      'Sign up free at cloudinary.com.',
      'In the Cloudinary console, open Settings → API Keys.',
      'Copy the Cloud name, API Key and API Secret into the boxes below.',
    ],
  },
  {
    id: 'imagekit',
    name: 'ImageKit',
    tagline: 'Photos and videos. Works like Cloudinary — resizes for you and saves data on video.',
    free: 'Free plan with monthly storage and bandwidth',
    kinds: ['image', 'video'],
    fields: [
      { key: 'url_endpoint', label: 'URL endpoint', placeholder: 'https://ik.imagekit.io/your_id' },
      { key: 'public_key', label: 'Public key' },
      { key: 'private_key', label: 'Private key', secret: true },
    ],
    limits: { storage: 20, bandwidth: 20 },
    steps: [
      'Sign up free at imagekit.io.',
      'Open Developer options in the dashboard.',
      'Copy the URL endpoint, Public key and Private key into the boxes below.',
      'Check your plan page for its storage and bandwidth allowance and enter them below, so we know when it’s full.',
    ],
  },
  {
    id: 'r2',
    name: 'Cloudflare R2',
    tagline: 'Photos and videos. Viewing and downloading are free — best for videos that get shared a lot.',
    free: '10 GB free, viewing free',
    kinds: ['image', 'video'],
    fields: [
      { key: 'account_id', label: 'Account ID', hint: 'On the R2 overview page, right side.' },
      { key: 'bucket', label: 'Bucket name' },
      { key: 'public_url', label: 'Public URL', placeholder: 'https://pub-xxxx.r2.dev' },
      { key: 'access_key_id', label: 'Access Key ID' },
      { key: 'secret_access_key', label: 'Secret Access Key', secret: true },
    ],
    limits: { storage: 10, bandwidth: null },
    steps: [
      'In the Cloudflare dashboard, open R2 and create a bucket (a card is needed to turn R2 on; the free allowance isn’t charged).',
      'In the bucket’s Settings, turn on Public access (the r2.dev subdomain is fine) and copy its Public URL.',
      'In the same Settings, find CORS policy and paste the rule shown below.',
      'Back on R2, open Manage API tokens → Create API token, choose Object Read & Write for this bucket, and copy the Access Key ID and Secret Access Key.',
    ],
    snippet: (o) => ({ title: 'CORS policy to paste', body: corsJson(o) }),
  },
  {
    id: 'b2',
    name: 'Backblaze B2',
    tagline: 'Photos and videos. Cheap storage; viewing is free up to three times what you store.',
    free: '10 GB free',
    kinds: ['image', 'video'],
    fields: [
      { key: 'bucket', label: 'Bucket name' },
      { key: 'endpoint', label: 'Endpoint', placeholder: 's3.us-west-004.backblazeb2.com', hint: 'Shown on the bucket’s card.' },
      { key: 'public_url', label: 'Public URL', placeholder: 'https://f004.backblazeb2.com/file/your-bucket', hint: 'The file “Friendly URL” up to and including the bucket name.' },
      { key: 'access_key_id', label: 'Key ID (keyID)' },
      { key: 'secret_access_key', label: 'Application key', secret: true },
    ],
    limits: { storage: 10, bandwidth: null },
    steps: [
      'Sign up free at backblaze.com and create a bucket with Files set to Public.',
      'On the bucket, open CORS Rules → “Share everything in this bucket with all HTTPS origins” and tick “S3 Compatible API”. (Or use a custom rule for just this site — shown below.)',
      'Open Application Keys → Add a New Application Key, allow access to this bucket with Read and Write, and copy the keyID and applicationKey (it’s shown once).',
      'Copy the bucket’s Endpoint, and a file’s Friendly URL up to the bucket name, into the boxes below.',
    ],
    snippet: (o) => ({ title: 'Custom CORS rule (optional)', body: corsJson(o) }),
  },
  {
    id: 'bunny',
    name: 'Bunny.net',
    tagline: 'Videos only. Pay as you go — about a cent per GB — with smooth streaming in several qualities.',
    free: 'Not free, very cheap',
    kinds: ['video'],
    fields: [
      { key: 'library_id', label: 'Video Library ID', numeric: true },
      { key: 'cdn_host', label: 'CDN hostname', placeholder: 'vz-abc123-456.b-cdn.net' },
      { key: 'api_key', label: 'API key', secret: true, hint: 'The library’s API key, not your account key.' },
    ],
    limits: { storage: null, bandwidth: null },
    steps: [
      'Sign up at bunny.net and open Stream → Add Video Library.',
      'In the library’s Encoding settings, turn on “Enable MP4 fallback” (and keep “Keep original files” on, for downloads).',
      'Open the library’s API page and copy the Video Library ID, CDN hostname and API key.',
    ],
  },
]

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
