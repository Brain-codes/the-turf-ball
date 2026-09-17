-- ============================================================================
-- Session scheduler: make it run again, pause at 30 minutes, end at 24 hours.
--
-- 1. THE CRASH. Since 20260824010001 the materialise step has read
--    `slot.duration_minutes`, but upcoming_slots() has never returned that
--    column. Every run of the 5-minute job failed on its first statement, so
--    for weeks nothing automatic happened at all: no sessions created ahead,
--    nothing went live at kick-off, and nothing was ever paused. The duration
--    is now looked up from session_slots, the same way step 3 already did.
--
--    Also fixed while here, because a working job would have exposed it:
--    upcoming_slots() decides "already scheduled" by the group's LOCAL date,
--    but the insert stored the UTC date. For a kickoff between local midnight
--    and the UTC offset (00:00-01:00 in Lagos) the two differ, the check never
--    matches, and a duplicate session would be created every five minutes.
--    session_date is now the local date, so the check and the row agree.
--
-- 2. PAUSE after 30 minutes with nothing recorded (was 20).
--
-- 3. END after 24 hours with nothing recorded. This reverses the old rule that
--    "only a human ends a session": a session left open overnight blocks the
--    month from closing and leaves its match clock running against wall time,
--    and in practice nobody comes back to end it. Ending does exactly what the
--    End session button does (sessions/handlers/attendance.ts completeSession):
--    unfinished matches are completed, the session is completed with
--    ended_at = now(), and the month's stats are recomputed. ended_at = now()
--    also means the usual 5-hour correction window starts from the auto-end,
--    so a missed tap can still be fixed.
-- ============================================================================

alter table public.sessions
  add column if not exists ended_reason text;

comment on column public.sessions.ended_reason is
  'Null when a person ended the session. ''inactivity'' when the scheduler ended it after 24 hours with nothing recorded.';

create or replace function public.materialize_and_flag_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org          record;
  slot         record;
  v_period     uuid;
  v_local_date date;
begin
  -- 1. Materialise.
  for org in
    select id, coalesce(timezone, 'UTC') as tz from public.organizations
    where status = 'active' and deleted_at is null
  loop
    perform public.ensure_open_period(org.id);

    for slot in
      select * from public.upcoming_slots(org.id, 30) as u
      where u.occurs_at <= now() + interval '7 days'
        and not u.already_scheduled
    loop
      v_local_date := (slot.occurs_at at time zone org.tz)::date;

      insert into public.sessions (
        organization_id, period_id, title, session_date, kickoff_at,
        venue, slot_id, status, is_auto_generated, scheduled_end_at
      ) values (
        org.id,
        public.period_for_date(org.id, v_local_date),
        slot.label, v_local_date, slot.occurs_at,
        slot.venue, slot.slot_id, 'scheduled', true,
        slot.occurs_at + make_interval(mins => coalesce(
          (select sl.duration_minutes from public.session_slots sl where sl.id = slot.slot_id),
          90
        ))
      );
    end loop;
  end loop;

  -- 2. Go live at kick-off.
  update public.sessions s
  set status = 'live'
  from public.organizations o
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'scheduled'
    and s.kickoff_at <= now();

  -- 3. Flag empties past their end time.
  update public.sessions s
  set flagged_inactive_at = now(), status = 'completed', ended_at = now()
  from public.organizations o
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'live'
    and s.flagged_inactive_at is null
    and now() > s.kickoff_at + make_interval(mins =>
      coalesce((select sl.duration_minutes from public.session_slots sl where sl.id = s.slot_id), 90)
    )
    and not exists (
      select 1 from public.session_attendance a
      where a.session_id = s.id and a.status = 'present'
    )
    and not exists (
      select 1 from public.matches m where m.session_id = s.id
    );

  -- 4. End anything silent for 24 hours — live or already paused. Runs
  -- before the pause step so a session that has been quiet for a day is
  -- ended outright rather than paused first.
  create temp table if not exists tmp_auto_ended (id uuid, period_id uuid) on commit drop;
  truncate tmp_auto_ended;

  with ended as (
    update public.sessions s
    set status = 'completed',
        ended_at = now(),
        ended_reason = 'inactivity',
        awaiting_confirmation = false,
        paused_at = null,
        paused_reason = null
    from public.organizations o
    where s.organization_id = o.id
      and o.deleted_at is null
      and s.status in ('live', 'paused')
      and coalesce(s.last_activity_at, s.actual_kickoff_at, s.kickoff_at) < now() - interval '24 hours'
    returning s.id, s.period_id
  )
  insert into tmp_auto_ended select id, period_id from ended;

  update public.matches m
  set status = 'completed', ended_at = now()
  where m.session_id in (select id from tmp_auto_ended)
    and m.status in ('pending', 'live');

  -- Recompute each affected month, but never a closed one — its numbers are
  -- frozen (an open session normally holds its month open, so this is a guard,
  -- not an expected case).
  for v_period in
    select distinct t.period_id
    from tmp_auto_ended t
    join public.periods p on p.id = t.period_id
    where p.status = 'open'
  loop
    perform public.recompute_period_stats(v_period);
  end loop;

  -- 5. Pause the quiet ones: 30 minutes with nothing recorded. Only sessions
  -- that got as far as a real match qualify — a session nobody has touched
  -- yet is step 3's business.
  update public.sessions s
  set status = 'paused',
      paused_at = now(),
      paused_reason = 'inactivity',
      awaiting_confirmation = false
  from public.organizations o
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'live'
    and coalesce(s.last_activity_at, s.actual_kickoff_at, s.kickoff_at) < now() - interval '30 minutes'
    and exists (
      select 1 from public.matches m where m.session_id = s.id
    );
end;
$$;

comment on column public.sessions.paused_at is
  'Set by materialize_and_flag_sessions() when a live session records nothing for 30 minutes. Cleared on resume. After 24 hours with nothing recorded the scheduler ends the session instead.';
