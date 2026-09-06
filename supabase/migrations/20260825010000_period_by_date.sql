-- ============================================================================
-- A session belongs to the month it is PLAYED in.
--
-- The bug this fixes, in full:
--
--   Sessions were stamped with "whichever month happens to be open right now"
--   at the moment the row was created, not with the month their own date falls
--   in. Two ways that goes wrong, both of them real:
--
--     1. The scheduler materialises sessions a week ahead. A session created
--        on 28 August for 2 September was filed under AUGUST. When August
--        closed, that September session was locked out — recording a goal in
--        it returned "August 2026 has been closed."
--
--     2. If a group stops playing for a while, the open month never moves. Come
--        back in December with September still open and every December session
--        is filed under September — December's goals counting towards
--        September's Player of the Month.
--
-- The rule now: the month is derived from the session's own date, and the
-- chain of months rolls forward on its own to reach it. A month that is
-- objectively over gets closed (awards, report and all) rather than sitting
-- open indefinitely — that is what makes "we came back in December" work.
--
-- period_for_date() is the single place that decides which month anything
-- belongs to. Nothing should read "the open period" to file a dated row again.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The season a date belongs to. Split out of ensure_open_period so both
-- callers agree.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_season(p_org uuid, p_date date)
returns uuid
language plpgsql
as $fn$
declare v_season uuid;
begin
  select id into v_season
  from public.seasons
  where organization_id = p_org and is_current
  limit 1;

  if v_season is null then
    insert into public.seasons (organization_id, name, starts_on, is_current)
    values (p_org, to_char(p_date, 'YYYY'), date_trunc('year', p_date)::date, true)
    returning id into v_season;
  end if;

  return v_season;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The period a given date belongs to, creating it if it does not exist yet.
--
-- Rolling forward: if the open month ended before today, it is over — close it
-- properly (freeze rules, award, write its report, open the next) and keep
-- going until the open month is the current one. Bounded, so a month that
-- refuses to close can never spin this.
--
-- A month that has not arrived yet is created in the closed state. It is not
-- "finished" — nothing can be played in it yet either — and close_period's
-- own "open the next month" step flips it open when the chain reaches it.
-- ---------------------------------------------------------------------------
create or replace function public.period_for_date(
  p_org   uuid,
  p_date  date,
  p_force boolean default true
)
returns uuid
language plpgsql
as $fn$
declare
  v_period uuid;
  v_open   record;
  v_tz     text;
  v_today  date;
  v_grace  int;
  v_guard  int := 0;
begin
  -- Already have it? Nothing else to decide.
  select id into v_period
  from public.periods
  where organization_id = p_org
    and p_date between starts_on and ends_on;
  if v_period is not null then
    return v_period;
  end if;

  select timezone into v_tz from public.organizations where id = p_org;
  v_today := (now() at time zone coalesce(nullif(v_tz, ''), 'UTC'))::date;

  select coalesce(auto_close_grace_days, 1) into v_grace
  from public.org_settings where organization_id = p_org;
  v_grace := coalesce(v_grace, 1);

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 60;

    select id, label, starts_on, ends_on into v_open
    from public.periods
    where organization_id = p_org and status = 'open'
    limit 1;

    -- No months at all yet.
    exit when v_open.id is null;

    if p_date between v_open.starts_on and v_open.ends_on then
      return v_open.id;
    end if;

    -- Never force a month shut before it has actually ended. Booking a
    -- 2 September session on 28 August must not close August.
    exit when v_open.ends_on >= v_today;

    -- p_force is the difference between "something dated genuinely needs a
    -- later month" (close and move on) and "just tell me the current month"
    -- (leave the grace window the organizer set alone, so last month can
    -- still be corrected for a day or two).
    exit when not p_force and v_today <= v_open.ends_on + v_grace;

    begin
      perform public.close_period(v_open.id, null);
    exception when others then
      raise exception
        'Cannot move on from %: %. Finish what is still open in that month first.',
        v_open.label, sqlerrm;
    end;
  end loop;

  -- Still nothing covering the date: create that month directly. Open only if
  -- it is the month we are actually in and nothing else is open.
  select id into v_period
  from public.periods
  where organization_id = p_org
    and p_date between starts_on and ends_on;
  if v_period is not null then
    return v_period;
  end if;

  insert into public.periods (
    organization_id, season_id, label, year, month, starts_on, ends_on, status
  ) values (
    p_org,
    public.ensure_season(p_org, p_date),
    to_char(p_date, 'FMMonth YYYY'),
    extract(year from p_date)::int,
    extract(month from p_date)::int,
    date_trunc('month', p_date)::date,
    (date_trunc('month', p_date) + interval '1 month - 1 day')::date,
    case
      when date_trunc('month', p_date) = date_trunc('month', v_today)
       and not exists (
         select 1 from public.periods
         where organization_id = p_org and status = 'open'
       )
      then 'open'::period_status
      else 'closed'::period_status
    end
  )
  on conflict (organization_id, year, month) do update
    set label = excluded.label
  returning id into v_period;

  return v_period;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- "The open month" now means the month we are actually in, not whichever one
-- was last left open. Everything that asks for the current month — the
-- dashboard, the leaderboard, the awards screen — gets the right answer even
-- after a break in play.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_open_period(p_org uuid)
returns uuid
language plpgsql
as $fn$
declare
  v_tz    text;
  v_today date;
begin
  select timezone into v_tz from public.organizations where id = p_org;
  v_today := (now() at time zone coalesce(nullif(v_tz, ''), 'UTC'))::date;
  return public.period_for_date(p_org, v_today, false);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The scheduler, republished. Only one thing changes: each session is filed
-- under the month its own kick-off falls in, rather than one month resolved
-- once per organization. That is the 28-August-creates-a-2-September-session
-- case above.
-- ---------------------------------------------------------------------------
create or replace function public.materialize_and_flag_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  org  record;
  slot record;
begin
  -- 1. Materialise.
  for org in
    select id from public.organizations
    where status = 'active' and deleted_at is null
  loop
    perform public.ensure_open_period(org.id);

    for slot in
      select * from public.upcoming_slots(org.id, 30) as u
      where u.occurs_at <= now() + interval '7 days'
        and not u.already_scheduled
    loop
      insert into public.sessions (
        organization_id, period_id, title, session_date, kickoff_at,
        venue, slot_id, status, is_auto_generated, scheduled_end_at
      ) values (
        org.id,
        public.period_for_date(org.id, (slot.occurs_at)::date),
        slot.label, (slot.occurs_at)::date, slot.occurs_at,
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

  -- 4. Pause the quiet ones.
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
$fn$;

-- ---------------------------------------------------------------------------
-- Repair for sessions already filed under the wrong month.
--
-- Deliberately NOT run on migration: it re-files real recorded play, so it is
-- the organizer's call, not a silent side effect of a deploy. Call it with
-- p_apply => false first to see exactly what would move.
--
--   select * from public.repair_session_periods('<org id>');              -- preview
--   select * from public.repair_session_periods('<org id>', true);        -- do it
-- ---------------------------------------------------------------------------
create or replace function public.repair_session_periods(p_org uuid, p_apply boolean default false)
returns table (
  session_id   uuid,
  session_date date,
  filed_under  text,
  belongs_to   text,
  moved        boolean
)
language plpgsql
as $fn$
declare
  s        record;
  v_target uuid;
  v_label  text;
  v_touched uuid[] := '{}';
  v_p      uuid;
begin
  for s in
    select se.id, se.session_date, se.period_id, pr.label as old_label
    from public.sessions se
    join public.periods pr on pr.id = se.period_id
    where se.organization_id = p_org
      and se.session_date not between pr.starts_on and pr.ends_on
    order by se.session_date
  loop
    v_label := to_char(s.session_date, 'FMMonth YYYY');

    if not p_apply then
      return query select s.id, s.session_date, s.old_label, v_label, false;
      continue;
    end if;

    v_target := public.period_for_date(p_org, s.session_date);

    update public.sessions set period_id = v_target where id = s.id;

    -- match_events carry their own copy of the period for fast stat queries.
    update public.match_events e
    set period_id = v_target
    from public.matches m
    where m.id = e.match_id and m.session_id = s.id;

    if not (s.period_id = any(v_touched)) then v_touched := v_touched || s.period_id; end if;
    if not (v_target = any(v_touched)) then v_touched := v_touched || v_target; end if;

    return query select s.id, s.session_date, s.old_label, v_label, true;
  end loop;

  -- Both the month they left and the month they landed in need their totals
  -- rebuilt, or the leaderboard keeps showing the old split.
  if p_apply then
    foreach v_p in array v_touched loop
      perform public.recompute_period_stats(v_p);
    end loop;
  end if;
end;
$fn$;
