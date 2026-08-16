-- ============================================================================
-- Self-starting sessions — materialise, then flag the empties.
--
-- DECIDED 16 Aug (see HANDOFF.md): sessions are created in advance from
-- session_slots by a scheduled job, as real rows (so they can be linked to
-- and shared before the day happens). If a session passes its end time with
-- no attendance marked present and no matches, the job flags it inactive. A
-- flagged session is still shown, clearly labelled, but excluded from every
-- accumulated record and total until an admin approves it.
--
-- The counted rule, used everywhere sessions are aggregated:
--   a session counts unless flagged_inactive_at IS NOT NULL AND approved_at IS NULL
-- ============================================================================

alter table public.sessions
  add column is_auto_generated boolean not null default false,
  add column flagged_inactive_at timestamptz,
  add column approved_at timestamptz,
  add column approved_by uuid references public.profiles(id) on delete set null;

create index sessions_flagged_idx on public.sessions(organization_id) where flagged_inactive_at is not null;

-- ---------------------------------------------------------------------------
-- The scheduler. Three jobs in one function, run together so a single cron
-- entry keeps the whole feature moving:
--   1. Materialise sessions for slots that don't have one yet, looking a week
--      ahead — reuses upcoming_slots(), which already resolves slots to real
--      timestamps in the organization's timezone.
--   2. Flip 'scheduled' -> 'live' once kick-off has passed. This is what
--      makes a session "go live on its own".
--   3. Flag sessions that are past their end time with no activity —
--      defined as at least one session_attendance row marked 'present', or
--      at least one match. Attendance alone counts because punctuality
--      points already flow from it (see HANDOFF.md open decision #4).
--
-- Soft-deleted organizations are skipped entirely — nothing should be
-- materialised, transitioned or flagged for a group that's in its 30-day
-- deletion window.
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
        venue, slot_id, status, is_auto_generated
      ) values (
        org.id, period_id, slot.label, (slot.occurs_at)::date, slot.occurs_at,
        slot.venue, slot.slot_id, 'scheduled', true
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
  set flagged_inactive_at = now(), status = 'completed'
  from public.organizations o
  left join public.session_slots sl on sl.id = s.slot_id
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'live'
    and s.flagged_inactive_at is null
    and now() > s.kickoff_at + make_interval(mins => coalesce(sl.duration_minutes, 90))
    and not exists (
      select 1 from public.session_attendance a
      where a.session_id = s.id and a.status = 'present'
    )
    and not exists (
      select 1 from public.matches m where m.session_id = s.id
    );
end;
$$;

select cron.schedule(
  'materialize-and-flag-sessions',
  '*/15 * * * *', -- every 15 minutes
  $$select public.materialize_and_flag_sessions();$$
);
