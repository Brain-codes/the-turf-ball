-- ============================================================================
-- The Turf Ball — initial schema
-- SPEC.md §8. Postgres on Supabase.
--
-- Architectural commitment: match_events is the ONLY source of truth.
-- Every statistic in the product is derived from it. Nothing is ever authored.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type org_format        as enum ('5aside', '7aside', '11aside', 'custom');
create type org_status        as enum ('active', 'archived');
create type member_role       as enum ('owner', 'admin', 'recorder');
create type member_status     as enum ('invited', 'active', 'revoked');
create type player_position   as enum ('GK', 'DEF', 'MID', 'FWD');
create type player_foot       as enum ('left', 'right', 'both');
create type player_status     as enum ('active', 'inactive', 'guest');
create type period_status     as enum ('open', 'closed');
create type session_status    as enum ('scheduled', 'live', 'completed', 'cancelled');
create type attendance_status as enum ('present', 'absent', 'excused');
create type punctuality_band  as enum ('early', 'on_time', 'late', 'very_late');
create type match_status      as enum ('pending', 'live', 'completed', 'abandoned');
create type match_side        as enum ('a', 'b');
create type clean_sheet_policy as enum ('goalkeeper', 'whole_side', 'manual');
create type vote_source       as enum ('organizer', 'member');

-- Extensible by design: adding an award means adding a value here plus a
-- scoring rule. It never means a schema redesign.
create type event_type as enum (
  'goal',
  'own_goal',
  'assist',
  'yellow_card',
  'red_card',
  'clean_sheet',
  'appearance',
  'punctuality',
  'save',
  'motm'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — mirrors auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null unique,
  full_name         text,
  avatar_url        text,
  is_platform_admin boolean not null default false,
  onboarded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- organizations — the tenant
-- ---------------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles(id) on delete restrict,
  name             text not null,
  short_name       text,
  slug             text not null unique,
  logo_url         text,
  description      text,
  location         text,
  venue            text,
  format           org_format not null default '5aside',
  players_per_side integer not null default 5 check (players_per_side between 3 and 11),
  playing_days     text[] not null default '{}',
  default_kickoff  time not null default '17:00',
  timezone         text not null default 'Africa/Lagos',
  status           org_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60)
);

create index organizations_owner_idx on public.organizations(owner_id);
create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create table public.organization_members (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete cascade,
  invited_email     text,
  role              member_role not null default 'recorder',
  status            member_status not null default 'invited',
  invite_token      text unique,
  invite_expires_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint member_identified check (user_id is not null or invited_email is not null)
);

create unique index members_org_user_uniq
  on public.organization_members(organization_id, user_id)
  where user_id is not null and status <> 'revoked';

create unique index members_org_email_uniq
  on public.organization_members(organization_id, lower(invited_email))
  where invited_email is not null and status <> 'revoked';

create index members_user_idx on public.organization_members(user_id) where status = 'active';

create trigger members_touch before update on public.organization_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- players — roster records, NOT user accounts
-- ---------------------------------------------------------------------------
create table public.players (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name      text not null,
  last_name       text,
  display_name    text not null,
  photo_url       text,
  jersey_number   integer check (jersey_number between 0 and 99),
  position        player_position,
  preferred_foot  player_foot,
  status          player_status not null default 'active',
  joined_at       timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index players_jersey_uniq
  on public.players(organization_id, jersey_number)
  where jersey_number is not null and status <> 'inactive';

create index players_org_status_idx on public.players(organization_id, status);

create trigger players_touch before update on public.players
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- seasons / periods
-- ---------------------------------------------------------------------------
create table public.seasons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  starts_on       date not null,
  ends_on         date,
  is_current      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index seasons_current_uniq
  on public.seasons(organization_id) where is_current;

create table public.periods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id       uuid references public.seasons(id) on delete set null,
  label           text not null,
  year            integer not null,
  month           integer not null check (month between 1 and 12),
  starts_on       date not null,
  ends_on         date not null,
  status          period_status not null default 'open',
  closed_at       timestamptz,
  closed_by       uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, year, month)
);

-- Exactly one open period per organization. Enforced, not hoped for.
create unique index periods_one_open_uniq
  on public.periods(organization_id) where status = 'open';

create index periods_org_idx on public.periods(organization_id, year desc, month desc);

create trigger periods_touch before update on public.periods
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sessions — one turn-up day
-- ---------------------------------------------------------------------------
create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id       uuid not null references public.periods(id) on delete restrict,
  title           text,
  session_date    date not null,
  kickoff_at      timestamptz not null,
  venue           text,
  status          session_status not null default 'scheduled',
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index sessions_org_date_idx on public.sessions(organization_id, session_date desc);
create index sessions_period_idx on public.sessions(period_id);

create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- session_attendance — presence and punctuality
-- ---------------------------------------------------------------------------
create table public.session_attendance (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  session_id         uuid not null references public.sessions(id) on delete cascade,
  player_id          uuid not null references public.players(id) on delete cascade,
  status             attendance_status not null default 'present',
  arrived_at         timestamptz,
  punctuality_band   punctuality_band,
  punctuality_points numeric(6,2) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (session_id, player_id)
);

create index attendance_player_idx on public.session_attendance(player_id);

create trigger attendance_touch before update on public.session_attendance
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
create table public.matches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  session_id       uuid not null references public.sessions(id) on delete cascade,
  sequence         integer not null default 1,
  duration_minutes integer not null default 20 check (duration_minutes between 1 and 180),
  started_at       timestamptz,
  ended_at         timestamptz,
  status           match_status not null default 'pending',
  side_a_label     text not null default 'Blue',
  side_b_label     text not null default 'Red',
  -- Denormalized cache. match_events remains authoritative; these are
  -- recomputed on every event write so the UI never has to aggregate.
  side_a_score     integer not null default 0,
  side_b_score     integer not null default 0,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (session_id, sequence)
);

create index matches_session_idx on public.matches(session_id);

create trigger matches_touch before update on public.matches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- match_players — the roster of a match. This is what makes an appearance.
-- ---------------------------------------------------------------------------
create table public.match_players (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  match_id        uuid not null references public.matches(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,
  side            match_side not null,
  is_goalkeeper   boolean not null default false,
  minutes_played  integer,
  created_at      timestamptz not null default now(),

  unique (match_id, player_id)
);

create index match_players_player_idx on public.match_players(player_id);

-- ---------------------------------------------------------------------------
-- match_events — THE SOURCE OF TRUTH
--
-- organization_id / session_id / period_id are denormalized deliberately.
-- Leaderboards aggregate across thousands of events in a period; carrying the
-- period on the row turns a four-table join into one indexed scan. Written
-- once at insert, never updated — a match cannot move between periods.
-- ---------------------------------------------------------------------------
create table public.match_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  match_id          uuid not null references public.matches(id) on delete cascade,
  session_id        uuid not null references public.sessions(id) on delete cascade,
  period_id         uuid not null references public.periods(id) on delete restrict,
  player_id         uuid not null references public.players(id) on delete cascade,
  related_player_id uuid references public.players(id) on delete set null,
  event_type        event_type not null,
  side              match_side,
  minute            integer check (minute >= 0),
  metadata          jsonb not null default '{}'::jsonb,
  -- Idempotency for the offline queue: a retry can never double-count.
  client_key        text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Events are never hard-deleted. Undo and corrections set voided_at, so the
  -- audit trail survives an argument about whether a goal counted.
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id) on delete set null
);

create unique index match_events_client_key_uniq
  on public.match_events(match_id, client_key)
  where client_key is not null;

create index match_events_period_type_idx
  on public.match_events(organization_id, period_id, event_type)
  where voided_at is null;

create index match_events_player_period_idx
  on public.match_events(player_id, period_id)
  where voided_at is null;

create index match_events_match_idx on public.match_events(match_id) where voided_at is null;

-- ---------------------------------------------------------------------------
-- scoring_rules
--
-- period_id null = the organization's current default.
-- period_id set  = a frozen snapshot taken when that period closed, so editing
--                  your weights in October can never rewrite August's winner.
-- ---------------------------------------------------------------------------
create table public.scoring_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id       uuid references public.periods(id) on delete cascade,
  event_type      event_type not null,
  points          numeric(6,2) not null default 0,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index scoring_rules_default_uniq
  on public.scoring_rules(organization_id, event_type)
  where period_id is null;

create unique index scoring_rules_period_uniq
  on public.scoring_rules(organization_id, period_id, event_type)
  where period_id is not null;

create trigger scoring_rules_touch before update on public.scoring_rules
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- org_settings — football and award configuration
-- ---------------------------------------------------------------------------
create table public.org_settings (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  clean_sheet_policy  clean_sheet_policy not null default 'goalkeeper',
  track_punctuality   boolean not null default true,
  track_cards         boolean not null default true,
  track_clean_sheets  boolean not null default true,
  guests_on_leaderboard boolean not null default true,
  -- Punctuality windows, in minutes relative to kickoff. Negative = before.
  early_before_mins   integer not null default 10,
  on_time_after_mins  integer not null default 5,
  late_after_mins     integer not null default 20,
  early_points        numeric(6,2) not null default 2,
  on_time_points      numeric(6,2) not null default 1,
  late_points         numeric(6,2) not null default 0,
  very_late_points    numeric(6,2) not null default -1,
  voting_enabled      boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger org_settings_touch before update on public.org_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- player_period_stats — materialized cache, never authored by a client
-- ---------------------------------------------------------------------------
create table public.player_period_stats (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  period_id          uuid not null references public.periods(id) on delete cascade,
  player_id          uuid not null references public.players(id) on delete cascade,
  appearances        integer not null default 0,
  goals              integer not null default 0,
  own_goals          integer not null default 0,
  assists            integer not null default 0,
  clean_sheets       integer not null default 0,
  yellow_cards       integer not null default 0,
  red_cards          integer not null default 0,
  saves              integer not null default 0,
  punctuality_score  numeric(8,2) not null default 0,
  vote_points        numeric(8,2) not null default 0,
  total_points       numeric(10,2) not null default 0,
  rank               integer,
  computed_at        timestamptz not null default now(),

  unique (organization_id, period_id, player_id)
);

create index stats_leaderboard_idx
  on public.player_period_stats(period_id, total_points desc);

-- ---------------------------------------------------------------------------
-- awards
-- ---------------------------------------------------------------------------
create table public.award_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade, -- null = system
  code            text not null,
  name            text not null,
  icon            text,
  description     text,
  enabled         boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create unique index award_types_system_code_uniq
  on public.award_types(code) where organization_id is null;

create unique index award_types_org_code_uniq
  on public.award_types(organization_id, code) where organization_id is not null;

create table public.awards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id       uuid not null references public.periods(id) on delete cascade,
  award_type_id   uuid not null references public.award_types(id) on delete restrict,
  player_id       uuid not null references public.players(id) on delete cascade,
  value           numeric(10,2),
  -- The full points calculation at award time. Permanently reproducible,
  -- even if the player is later renamed or the scoring rules change.
  breakdown       jsonb not null default '{}'::jsonb,
  awarded_at      timestamptz not null default now(),

  unique (organization_id, period_id, award_type_id)
);

create index awards_player_idx on public.awards(player_id);

create table public.award_votes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  period_id          uuid not null references public.periods(id) on delete cascade,
  voter_user_id      uuid references public.profiles(id) on delete cascade,
  voter_fingerprint  text,
  player_id          uuid not null references public.players(id) on delete cascade,
  weight             numeric(6,2) not null default 1,
  source             vote_source not null default 'member',
  created_at         timestamptz not null default now()
);

create unique index votes_user_uniq
  on public.award_votes(period_id, voter_user_id) where voter_user_id is not null;
create unique index votes_fingerprint_uniq
  on public.award_votes(period_id, voter_fingerprint) where voter_fingerprint is not null;

-- ---------------------------------------------------------------------------
-- public_pages
-- ---------------------------------------------------------------------------
create table public.public_pages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null unique references public.organizations(id) on delete cascade,
  slug              text not null unique,
  is_published      boolean not null default true,
  show_photos       boolean not null default true,
  show_cards        boolean not null default true,
  show_punctuality  boolean not null default true,
  show_sessions     boolean not null default true,
  theme             text not null default 'default',
  view_count        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger public_pages_touch before update on public.public_pages
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id        uuid references public.profiles(id) on delete set null,
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);

create index audit_org_idx on public.audit_log(organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Deny-all everywhere. Clients never touch tables directly (rule2.txt §1), so
-- Edge Functions use the service role, which bypasses RLS. This is a hard
-- backstop against a leaked anon key — not the authorization mechanism.
-- Authorization lives in the Edge Function membership check.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','organizations','organization_members','players','seasons','periods',
    'sessions','session_attendance','matches','match_players','match_events',
    'scoring_rules','org_settings','player_period_stats','award_types','awards',
    'award_votes','public_pages','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: system award types
-- ---------------------------------------------------------------------------
insert into public.award_types (organization_id, code, name, icon, description, sort_order) values
  (null, 'player_of_month', 'Player of the Month', '🏆', 'Highest total points across all criteria', 1),
  (null, 'golden_boot',     'Golden Boot',         '⚽', 'Most goals scored',                        2),
  (null, 'playmaker',       'Playmaker',           '🎯', 'Most assists',                             3),
  (null, 'golden_glove',    'Golden Glove',        '🧤', 'Most clean sheets',                        4),
  (null, 'iron_man',        'Iron Man',            '🟢', 'Most appearances',                         5),
  (null, 'most_punctual',   'Most Punctual',       '⏰', 'Best punctuality score',                   6),
  (null, 'fan_favourite',   'Fan Favourite',       '⭐', 'Most votes',                               7);
