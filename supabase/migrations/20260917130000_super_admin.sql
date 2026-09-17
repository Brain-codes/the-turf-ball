-- ============================================================================
-- Super admin: platform-wide oversight.
--
-- 1. profiles.is_platform_admin already exists (initial schema). Grant it to
--    the platform owner's account.
-- 2. platform_features — switches the super admin can flip for everyone.
--    Read by Edge Functions; the public list is exposed read-only through
--    the `public` function so the app can hide switched-off features.
-- 3. admin_actions — who did what, for every super admin change.
-- 4. org-logos Storage bucket — public read, written only by Edge Functions.
--
-- All new tables are RLS deny-all, like everything else.
-- ============================================================================

update public.profiles
set is_platform_admin = true
where lower(email) = 'adenugaadewumi01@gmail.com';

create table public.platform_features (
  key          text primary key,
  label        text not null,
  description  text not null,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

insert into public.platform_features (key, label, description) values
  ('new_groups',      'New group sign-ups',   'People can create new football groups.'),
  ('public_tables',   'Public tables',        'The all-groups tables page and its data.'),
  ('head_to_head',    'Head-to-head',         'Public player-versus-player comparisons.'),
  ('self_join_links', 'Player invite links',  'Players can add themselves to a group through its invite link.'),
  ('contact_form',    'Contact form',         'Visitors can send messages through the Contact page.')
on conflict (key) do nothing;

alter table public.platform_features enable row level security;
revoke all on public.platform_features from anon, authenticated;

create table public.admin_actions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_type  text not null,
  target_id    text,
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index admin_actions_recent on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
