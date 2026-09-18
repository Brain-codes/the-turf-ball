-- ============================================================================
-- Team galleries, stored on Cloudinary.
--
-- 1. 'uploader' member role — can use the gallery and nothing else.
-- 2. cloudinary_accounts — each group's ordered pool of Cloudinary accounts.
--    The API secret is stored ONLY as AES-256-GCM ciphertext; the key lives
--    in the Edge Function env (GALLERY_ENCRYPTION_KEY), never in the database.
--    New uploads go to the first account (by position) under its threshold.
-- 3. gallery_albums (public/private per album), gallery_media, favourites.
-- 4. gallery_upload_intents — a signed upload is only accepted back if we
--    issued it, for that group, to that user.
-- 5. Two pg_cron jobs call the gallery function through pg_net: hourly usage
--    refresh and a daily purge of anything in the trash for 30+ days. The
--    shared secret and project URL are read from Vault at run time.
--
-- All tables RLS deny-all, like everything else.
-- ============================================================================

alter type member_role add value if not exists 'uploader';

alter table public.organizations
  add column if not exists gallery_enabled boolean not null default false;

insert into public.platform_features (key, label, description) values
  ('gallery', 'Team galleries', 'Groups with storage attached can upload photos and videos, and share public galleries.')
on conflict (key) do nothing;

create table public.cloudinary_accounts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  label              text not null,
  cloud_name         text not null,
  api_key            text not null,
  secret_ciphertext  text not null,
  secret_iv          text not null,
  secret_last4       text not null,
  position           int not null default 0,
  enabled            boolean not null default true,
  threshold_pct      numeric(5,2) not null default 95 check (threshold_pct between 10 and 100),
  -- Last usage snapshot from Cloudinary's Admin API.
  usage_pct          numeric(6,2),
  credits_used       numeric,
  credits_limit      numeric,
  storage_bytes      bigint,
  bandwidth_bytes    bigint,
  transformations    bigint,
  resources          bigint,
  plan               text,
  -- Bytes confirmed since the last snapshot, so rollover reacts between checks.
  pending_bytes      bigint not null default 0,
  last_checked_at    timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  unique (organization_id, cloud_name)
);
create index cloudinary_accounts_org on public.cloudinary_accounts (organization_id, position);

create table public.gallery_albums (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  description      text,
  visibility       text not null default 'public' check (visibility in ('public', 'private')),
  cover_media_id   uuid,
  event_date       date,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index gallery_albums_org on public.gallery_albums (organization_id, created_at desc);

create table public.gallery_media (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  album_id         uuid references public.gallery_albums(id) on delete set null,
  account_id       uuid not null references public.cloudinary_accounts(id) on delete restrict,
  public_id        text not null,
  resource_type    text not null check (resource_type in ('image', 'video')),
  format           text,
  bytes            bigint not null default 0,
  width            int,
  height           int,
  duration         numeric,
  version          bigint,
  title            text,
  original_filename text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  favourite_count  int not null default 0,
  download_count   int not null default 0,
  compressed       boolean not null default false,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles(id) on delete set null,
  unique (account_id, public_id)
);
create index gallery_media_org_live on public.gallery_media (organization_id, created_at desc) where deleted_at is null;
create index gallery_media_album on public.gallery_media (album_id, created_at desc) where deleted_at is null;
create index gallery_media_trash on public.gallery_media (deleted_at) where deleted_at is not null;

alter table public.gallery_albums
  add constraint gallery_albums_cover_fk foreign key (cover_media_id) references public.gallery_media(id) on delete set null;

-- One heart per visitor per item. visitor_id is a random id the browser keeps;
-- it is not tied to any account.
create table public.gallery_favourites (
  media_id    uuid not null references public.gallery_media(id) on delete cascade,
  visitor_id  text not null check (length(visitor_id) between 16 and 64),
  created_at  timestamptz not null default now(),
  primary key (media_id, visitor_id)
);

create table public.gallery_upload_intents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  account_id       uuid not null references public.cloudinary_accounts(id) on delete cascade,
  public_id        text not null,
  resource_type    text not null,
  album_id         uuid references public.gallery_albums(id) on delete set null,
  created_by       uuid not null references public.profiles(id) on delete cascade,
  expires_at       timestamptz not null,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index gallery_upload_intents_stale on public.gallery_upload_intents (expires_at) where completed_at is null;

-- Favourite counter kept by the database so it can't drift.
create or replace function public.gallery_favourite_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update gallery_media set favourite_count = favourite_count + 1 where id = new.media_id;
  else
    update gallery_media set favourite_count = greatest(favourite_count - 1, 0) where id = old.media_id;
  end if;
  return null;
end $$;

create trigger gallery_favourites_count
after insert or delete on public.gallery_favourites
for each row execute function public.gallery_favourite_count();

create or replace function public.gallery_bump_download(ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update gallery_media set download_count = download_count + 1 where id = any(ids);
$$;

do $$
declare t text;
begin
  foreach t in array array['cloudinary_accounts','gallery_albums','gallery_media','gallery_favourites','gallery_upload_intents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function public.gallery_bump_download(uuid[]) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Scheduled work. pg_net calls the gallery function; it needs two Vault
-- secrets: 'project_url' and 'gallery_cron_secret' (set outside migrations
-- so the secret never lands in git).
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function public.gallery_cron_call(path text) returns void
language plpgsql security definer set search_path = public as $$
declare
  base text;
  secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'gallery_cron_secret';
  if base is null or secret is null then
    raise notice 'gallery cron skipped: vault secrets missing';
    return;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/gallery/' || path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.gallery_cron_call(text) from anon, authenticated, public;

select cron.schedule('gallery-refresh-usage', '7 * * * *', $$select public.gallery_cron_call('cron/usage')$$);
select cron.schedule('gallery-purge-trash', '30 3 * * *', $$select public.gallery_cron_call('cron/purge')$$);

-- Per-account file counts for the storage dashboard.
create or replace function public.gallery_account_stats(org uuid)
returns table (account_id uuid, files bigint, bytes bigint, trashed bigint, images bigint, videos bigint)
language sql stable security definer set search_path = public as $$
  select account_id,
         count(*) filter (where deleted_at is null),
         coalesce(sum(bytes) filter (where deleted_at is null), 0)::bigint,
         count(*) filter (where deleted_at is not null),
         count(*) filter (where deleted_at is null and resource_type = 'image'),
         count(*) filter (where deleted_at is null and resource_type = 'video')
  from gallery_media where organization_id = org group by account_id;
$$;
revoke all on function public.gallery_account_stats(uuid) from anon, authenticated, public;

-- Photo/video counts per album (null album = Unsorted), live files only.
create or replace function public.gallery_album_counts(org uuid)
returns table (album_id uuid, photos bigint, videos bigint)
language sql stable security definer set search_path = public as $$
  select album_id,
         count(*) filter (where resource_type = 'image'),
         count(*) filter (where resource_type = 'video')
  from gallery_media where organization_id = org and deleted_at is null
  group by album_id;
$$;
revoke all on function public.gallery_album_counts(uuid) from anon, authenticated, public;
