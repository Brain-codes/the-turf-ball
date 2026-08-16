-- ============================================================================
-- Account deletion, with a 30-day grace period.
--
-- DECIDED 16 Aug (see HANDOFF.md): deleting an account also deletes the
-- organizations it owns, behind an explicit two-step confirmation in the Edge
-- Function layer. During the 30-day window the group is hidden, not
-- destroyed — deleted_at is set on both profiles and organizations so either
-- can be reactivated together. Only the day-30 purge deletes for real.
-- ============================================================================

alter table public.profiles
  add column deleted_at timestamptz;

alter table public.organizations
  add column deleted_at timestamptz;

create index profiles_deleted_idx on public.profiles(deleted_at) where deleted_at is not null;
create index organizations_deleted_idx on public.organizations(deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- Hard purge — runs daily. Deletes anything whose grace period has expired.
--
-- Order matters: organizations.owner_id references profiles(id) ON DELETE
-- RESTRICT, so a still-owned organization blocks deleting the profile. We
-- delete owned organizations first, then the auth.users row — which cascades
-- to profiles via profiles.id references auth.users(id) ON DELETE CASCADE.
-- security definer because deleting from auth.users needs elevated rights
-- that the function's caller (pg_cron, running as postgres) already has, but
-- this makes it explicit and safe to call from anywhere.
-- ---------------------------------------------------------------------------
create or replace function public.purge_deleted_accounts()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  rec record;
begin
  -- Organizations deleted on their own (should not normally happen — deletion
  -- today always goes through the owning profile — but handled for safety).
  delete from public.organizations
  where deleted_at is not null and deleted_at < now() - interval '30 days';

  for rec in
    select id from public.profiles
    where deleted_at is not null and deleted_at < now() - interval '30 days'
  loop
    delete from public.organizations where owner_id = rec.id;
    delete from auth.users where id = rec.id; -- cascades to public.profiles
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling. pg_cron is a standard Supabase-supported extension; if this
-- project's plan or config rejects it, the two `create extension` / `select
-- cron.schedule` statements below will fail `supabase db push` and must be
-- removed — see HANDOFF.md for the Edge Function fallback in that case.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'purge-deleted-accounts',
  '0 3 * * *', -- daily at 03:00 UTC
  $$select public.purge_deleted_accounts();$$
);
