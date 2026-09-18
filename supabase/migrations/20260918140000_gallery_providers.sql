-- ============================================================================
-- Gallery storage beyond Cloudinary: ImageKit, Cloudflare R2, Backblaze B2
-- and Bunny.net Stream.
--
-- Additive only, so the live gallery keeps working while functions redeploy.
-- The table keeps its original name (cloudinary_accounts) and cloud_name now
-- holds each provider's identifier (cloud name, ImageKit id, bucket, library).
--
-- - provider: which service this account is.
-- - config: the non-secret settings (public key, bucket, public URL…).
-- - secret_ciphertext now holds an encrypted JSON object of the provider's
--   secrets. Rows written before this migration hold a bare Cloudinary API
--   secret; the code reads both.
-- - storage_limit_bytes / bandwidth_limit_bytes: for providers whose usage
--   API doesn't report plan limits, the team enters them. NULL = no cap
--   (pay-as-you-go, e.g. Bunny).
-- - kinds: what the account takes. Bunny Stream is video-only.
-- ============================================================================

alter table public.cloudinary_accounts
  add column if not exists provider text not null default 'cloudinary'
    check (provider in ('cloudinary', 'imagekit', 'r2', 'b2', 'bunny')),
  add column if not exists config jsonb not null default '{}',
  add column if not exists storage_limit_bytes bigint,
  add column if not exists bandwidth_limit_bytes bigint,
  add column if not exists kinds text[] not null default array['image', 'video'];

alter table public.gallery_media
  -- ImageKit fileId / Bunny video id. Cloudinary and S3 use public_id alone.
  add column if not exists provider_file_id text,
  -- For storage that can't resize (R2, B2): the phone uploads a small grid
  -- image and a full-screen copy alongside the original.
  add column if not exists has_thumb boolean not null default false,
  add column if not exists has_full boolean not null default false;

alter table public.gallery_upload_intents
  add column if not exists provider_file_id text;

-- Stored bytes per account from our own records — the only usage figure
-- R2, B2 and Bunny give us without extra API tokens.
create or replace function public.gallery_account_bytes(acc uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(bytes), 0)::bigint from gallery_media where account_id = acc;
$$;
revoke all on function public.gallery_account_bytes(uuid) from anon, authenticated, public;
