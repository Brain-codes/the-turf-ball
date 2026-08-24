-- ============================================================================
-- Auto-pause a session that has gone quiet.
--
-- The problem this fixes: a session started on the pitch and never ended
-- keeps its match clock running against real wall time. Come back the next
-- morning and the clock reads 931' — past the 200-minute cap the events API
-- accepts, so nothing can be recorded at all.
--
-- The rule now: a session with a real match on it that has recorded nothing
-- for 20 minutes is PAUSED, not completed. Pausing is deliberately not the
-- same as ending:
--   * the session is no longer live, so it stops behaving like one
--     (no heartbeat, not counted as in-progress, period can close)
--   * nothing is finalised — no ended_at, matches are left exactly as they
--     were, so resuming picks the same match back up
--   * the next person to open the session or the dashboard is told what
--     happened and chooses: resume, or end it themselves
--
-- Ending a session stays a human decision. The scheduler never does it.
-- ============================================================================

alter table public.sessions
  add column paused_at     timestamptz,
  add column paused_reason text;

comment on column public.sessions.paused_at is
  'Set by materialize_and_flag_sessions() when a live session records nothing for 20 minutes. Cleared on resume. Never implies the session ended — only a human ends a session.';
comment on column public.sessions.paused_reason is
  'Why it was paused. Currently only ''inactivity''.';

create index sessions_paused_idx on public.sessions(organization_id) where paused_at is not null;

-- ---------------------------------------------------------------------------
-- Steps 1-3 are unchanged from 20260817130000. Step 4 replaces the old
-- "gone quiet past scheduled end -> prompt or auto-close" behaviour with the
-- pause. The scheduled end time no longer gates it: 20 minutes of silence is
-- 20 minutes of silence whether or not the session was booked to still be
-- running, and the old prompt-vs-close split (which depended on whether
-- anyone still had the live screen open) is gone — pausing is safe enough to
-- do unconditionally, because it throws nothing away.
-- ---------------------------------------------------------------------------
create or replace function public.materialize_and_flag_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org record;
  slot record;
  period_id uuid;
begin
  -- 1. Materialise.
  for org in
    select id from public.organizations
    where status = 'active' and deleted_at is null
  loop
    period_id := public.ensure_open_period(org.id);

    for slot in
      select * from public.upcoming_slots(org.id, 30) as u
      where u.occurs_at <= now() + interval '7 days'
        and not u.already_scheduled
    loop
      insert into public.sessions (
        organization_id, period_id, title, session_date, kickoff_at,
        venue, slot_id, status, is_auto_generated, scheduled_end_at
      ) values (
        org.id, period_id, slot.label, (slot.occurs_at)::date, slot.occurs_at,
        slot.venue, slot.slot_id, 'scheduled', true,
        slot.occurs_at + make_interval(mins => coalesce(slot.duration_minutes, 90))
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

  -- 3. Flag empties past their end time. End time = kickoff + the slot's
  -- duration, or 90 minutes for one-off sessions with no slot.
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

  -- 4. Pause the quiet ones. Only sessions that got as far as a real match
  -- qualify — a session nobody has touched yet is step 3's business, and
  -- pausing it would just get in the way of an organizer arriving late.
  update public.sessions s
  set status = 'paused',
      paused_at = now(),
      paused_reason = 'inactivity',
      awaiting_confirmation = false
  from public.organizations o
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'live'
    and coalesce(s.last_activity_at, s.actual_kickoff_at, s.kickoff_at) < now() - interval '20 minutes'
    and exists (
      select 1 from public.matches m where m.session_id = s.id
    );
end;
$$;

-- Every 5 minutes rather than 15: a 20-minute rule checked quarter-hourly
-- can take 35 minutes to fire, which is long enough for the clock to drift
-- somewhere silly again.
select cron.unschedule('materialize-and-flag-sessions');
select cron.schedule(
  'materialize-and-flag-sessions',
  '*/5 * * * *',
  $$select public.materialize_and_flag_sessions();$$
);
