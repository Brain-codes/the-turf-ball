-- ============================================================================
-- Session slots — flexible recurring schedule.
--
-- The original model assumed one playing day and one kick-off time. Real groups
-- are not like that: Sunday morning AND Sunday evening, a Tuesday five-a-side,
-- a different time in the rainy season. A slot is one recurring fixture, and a
-- group can have as many as it likes.
--
-- Sessions were already unconstrained on date, so multiple sessions per day
-- always worked at the data level. What was missing was a way to describe and
-- edit the regular pattern.
-- ============================================================================

create table public.session_slots (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  label            text,
  -- 0 = Sunday … 6 = Saturday, matching JavaScript's Date.getDay() so the
  -- frontend never has to translate.
  weekday          integer not null check (weekday between 0 and 6),
  kickoff          time not null,
  duration_minutes integer not null default 90 check (duration_minutes between 15 and 480),
  venue            text,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The same day and time twice is a duplicate, not a second fixture.
  unique (organization_id, weekday, kickoff)
);

create index session_slots_org_idx
  on public.session_slots(organization_id, weekday, kickoff)
  where is_active;

create trigger session_slots_touch before update on public.session_slots
  for each row execute function public.touch_updated_at();

alter table public.session_slots enable row level security;
alter table public.session_slots force row level security;

-- Link a session back to the slot it came from, so the app can label it
-- ("Sunday Evening") without the organizer retyping it every week.
-- Nullable: one-off sessions belong to no slot, and deleting a slot must not
-- delete the history played under it.
alter table public.sessions
  add column slot_id uuid references public.session_slots(id) on delete set null;

create index sessions_slot_idx on public.sessions(slot_id);

-- ---------------------------------------------------------------------------
-- Backfill: turn each existing group's single playing day + kick-off into a
-- real slot, so nobody loses the schedule they set up during onboarding.
-- ---------------------------------------------------------------------------
insert into public.session_slots (organization_id, label, weekday, kickoff, venue, sort_order)
select
  o.id,
  null,
  case lower(d)
    when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2
    when 'wednesday' then 3 when 'thursday' then 4 when 'friday' then 5
    when 'saturday' then 6
  end,
  o.default_kickoff,
  o.venue,
  idx
from public.organizations o
cross join lateral unnest(o.playing_days) with ordinality as t(d, idx)
where lower(d) in ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The next N occurrences across every active slot, in chronological order.
-- Used by the "new session" screen so the common case is one tap.
-- ---------------------------------------------------------------------------
create or replace function public.upcoming_slots(p_org uuid, p_limit integer default 8)
returns table (
  slot_id    uuid,
  label      text,
  weekday    integer,
  kickoff    time,
  venue      text,
  occurs_at  timestamptz,
  already_scheduled boolean
)
language sql
stable
as $$
  with tz as (
    select coalesce(timezone, 'UTC') as name from public.organizations where id = p_org
  ),
  today as (
    select (now() at time zone (select name from tz))::date as d
  ),
  -- Look two weeks ahead: enough to cover every weekday twice, so a slot that
  -- falls today but has already kicked off still shows its next occurrence.
  days as (
    select ((select d from today) + offs)::date as the_date
    from generate_series(0, 14) as offs
  )
  select
    s.id,
    s.label,
    s.weekday,
    s.kickoff,
    coalesce(s.venue, o.venue),
    ((d.the_date + s.kickoff) at time zone (select name from tz)) as occurs_at,
    exists (
      select 1 from public.sessions x
      where x.organization_id = p_org
        and x.session_date = d.the_date
        and x.slot_id = s.id
    ) as already_scheduled
  from public.session_slots s
  join public.organizations o on o.id = s.organization_id
  join days d on extract(dow from d.the_date)::int = s.weekday
  where s.organization_id = p_org
    and s.is_active
    and ((d.the_date + s.kickoff) at time zone (select name from tz))
        > (now() - interval '3 hours')
  order by occurs_at
  limit p_limit;
$$;
