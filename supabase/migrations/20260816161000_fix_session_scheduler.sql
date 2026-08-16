-- ============================================================================
-- Fix: materialize_and_flag_sessions() referenced the UPDATE target table (s)
-- from inside a FROM-clause JOIN's ON condition, which Postgres rejects
-- ("invalid reference to FROM-clause entry for table s"). Replaced the join
-- with a scalar subquery for the slot's duration instead.
-- ============================================================================
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
end;
$$;
