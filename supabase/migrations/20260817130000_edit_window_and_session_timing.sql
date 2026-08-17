-- Four related changes to how a session behaves around its own start/end:
--
-- 1. Post-session edit window: goals/assists/cards can be corrected for 5
--    hours after a session ends (missing assist, wrong scorer, a card that
--    shouldn't have been given) — with an audit trail of what changed.
-- 2. A session with real activity that goes quiet past its scheduled end
--    time doesn't get force-closed while people are still on the live
--    screen — it prompts first, and only auto-closes if nobody's watching.
-- 3. Punctuality is judged against when the session ACTUALLY kicked off,
--    not the scheduled time — a group that starts 30 minutes late doesn't
--    retroactively make everyone who showed up on time "late".
-- 4. The session detail screen can show the real timeline: how late it
--    started, how long it actually ran.

alter table public.sessions
  add column actual_kickoff_at   timestamptz,
  add column ended_at            timestamptz,
  add column scheduled_end_at    timestamptz,
  add column last_activity_at    timestamptz,
  add column last_viewed_at      timestamptz,
  add column awaiting_confirmation boolean not null default false;

comment on column public.sessions.actual_kickoff_at is
  'When the organizer actually hit Start — punctuality is judged against this, not kickoff_at.';
comment on column public.sessions.scheduled_end_at is
  'kickoff_at + expected duration, computed once at creation. Null if unknowable (no slot, no default).';
comment on column public.sessions.awaiting_confirmation is
  'Set by materialize_and_flag_sessions() when a live session has gone quiet past its scheduled end and someone is still on the live screen — the UI shows a "still going?" prompt instead of auto-closing.';

-- Backfill: best-effort actual_kickoff_at for sessions already live/completed
-- from before this column existed, so punctuality recompute and the timeline
-- display aren't blank for anything already in play.
update public.sessions
set actual_kickoff_at = kickoff_at
where status in ('live', 'completed') and actual_kickoff_at is null;

-- Audit trail for editing an existing event's facts (who scored, who
-- assisted, what minute) after the fact. Voiding an event already has its
-- own trail (voided_at/voided_by on match_events) — this covers everything
-- short of deleting.
create table public.match_event_edits (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id        uuid not null references public.match_events(id) on delete cascade,
  edited_by       uuid references public.profiles(id) on delete set null,
  edited_at       timestamptz not null default now(),
  -- { "player_id": { "from": "...", "to": "..." }, ... }
  changes         jsonb not null
);

create index match_event_edits_event_idx on public.match_event_edits(event_id);

alter table public.match_events
  add column edited_at timestamptz,
  add column edited_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Extend the existing 15-minute scheduler with the "gone quiet" check.
-- Steps 1-3 are unchanged from 20260816161000; step 4 is new.
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
  v_to_close uuid[];
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

  -- 4. A session with real activity (attendance and/or a match) that has
  -- gone quiet for 15+ minutes past its scheduled end time. If someone is
  -- still on the live screen (a heartbeat in the last 3 minutes — the live
  -- view polls every 30s), just flag it for a "still going?" prompt rather
  -- than closing it out from under them. Otherwise, nobody's watching —
  -- close it for real.
  select array_agg(s.id) into v_to_close
  from public.sessions s
  join public.organizations o on o.id = s.organization_id
  where o.deleted_at is null
    and s.status = 'live'
    and s.scheduled_end_at is not null
    and now() > s.scheduled_end_at
    and coalesce(s.last_activity_at, s.actual_kickoff_at, s.kickoff_at) < now() - interval '15 minutes'
    and (s.last_viewed_at is null or s.last_viewed_at < now() - interval '3 minutes');

  if v_to_close is not null then
    update public.sessions
    set status = 'completed', ended_at = now(), awaiting_confirmation = false
    where id = any(v_to_close);

    update public.matches
    set status = 'completed', ended_at = now()
    where session_id = any(v_to_close) and status in ('pending', 'live');
  end if;

  update public.sessions s
  set awaiting_confirmation = true
  from public.organizations o
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'live'
    and s.scheduled_end_at is not null
    and now() > s.scheduled_end_at
    and coalesce(s.last_activity_at, s.actual_kickoff_at, s.kickoff_at) < now() - interval '15 minutes'
    and s.last_viewed_at is not null and s.last_viewed_at > now() - interval '3 minutes'
    and not s.awaiting_confirmation;
end;
$$;
