-- ============================================================================
-- Closing a month tidies up after itself.
--
-- The bug, found the hard way: a 30 August session that nobody played was
-- still sitting in August when August closed. On 6 September someone opened
-- it, picked teams, and could not record a single goal — the session's month
-- was shut, so every event was refused. There was no way out of it from
-- inside the app.
--
-- Two things were wrong, and the other one is fixed in
-- 20260825010000_period_by_date.sql (a session created a week ahead was being
-- filed under the month that was open at the time, not the month it is
-- played in). This migration fixes the second: a month that closes leaves no
-- unplayable sessions behind it.
--
-- close_period already refuses to close while a session is live or paused.
-- A merely 'scheduled' session never blocked anything, because blocking on it
-- would mean one forgotten session could hold a month open forever — and with
-- months now closing themselves, hold it open forever unattended. Cancelling
-- is the honest answer: the month is over and that session did not happen.
-- ============================================================================

create or replace function public.close_period(p_period uuid, p_actor uuid)
returns jsonb
language plpgsql
as $fn$
declare
  v_org       uuid;
  v_status    period_status;
  v_live      integer;
  v_next      uuid;
  v_next_date date;
  v_season    uuid;
  v_awards    jsonb;
  v_report    jsonb;
begin
  select organization_id, status, season_id
    into v_org, v_status, v_season
  from public.periods where id = p_period;

  if v_org is null then
    raise exception 'Period not found';
  end if;
  if v_status = 'closed' then
    raise exception 'Period is already closed';
  end if;

  -- A live or paused session means someone is still recording. Closing now
  -- would strand their events in a locked month.
  select count(*) into v_live
  from public.sessions
  where period_id = p_period and status in ('live', 'paused');
  if v_live > 0 then
    raise exception 'Cannot close: % session(s) still unfinished', v_live;
  end if;

  -- A session that never happened must not be sealed inside a closed month.
  -- The scheduler creates sessions a week ahead, so a month almost always ends
  -- with one or two that nobody turned up to. Left alone they become
  -- landmines: their month is shut, so they can never be played and nothing
  -- can ever be recorded in them — which is exactly what happened to a
  -- 30 August session someone opened on 6 September and could not record a
  -- single goal in. They did not happen, so they are cancelled.
  --
  -- Only genuinely empty, past-dated ones. Anything with a person marked
  -- present or a match on it is real and is left exactly as it is.
  update public.sessions s
  set status = 'cancelled'
  where s.period_id = p_period
    and s.status = 'scheduled'
    and s.session_date <= (select ends_on from public.periods where id = p_period)
    and not exists (
      select 1 from public.session_attendance a
      where a.session_id = s.id and a.status = 'present'
    )
    and not exists (
      select 1 from public.matches m where m.session_id = s.id
    );

  -- 1. Freeze the scoring rules into this period, so later edits to the
  --    organization's defaults can never rewrite this month's result.
  insert into public.scoring_rules (organization_id, period_id, event_type, points, enabled)
  select organization_id, p_period, event_type, points, enabled
  from public.scoring_rules
  where organization_id = v_org and period_id is null
  on conflict do nothing;

  -- 2. Final recompute against the now-frozen rules.
  perform public.recompute_period_stats(p_period);

  -- 3. Award every enabled award type.
  with s as (
    select st.*, pl.joined_at, pl.status as player_status
    from public.player_period_stats st
    join public.players pl on pl.id = st.player_id
    where st.period_id = p_period
      and st.appearances > 0
  ),
  winners as (
    (select 'player_of_month'::text as code, player_id, total_points::numeric as value
     from s
     order by total_points desc, goals desc, assists desc, red_cards asc,
              yellow_cards asc, appearances desc, punctuality_score desc, joined_at asc
     limit 1)
    union all
    (select 'golden_boot'::text, player_id, goals::numeric from s where goals > 0
     order by goals desc, appearances asc, joined_at asc limit 1)
    union all
    (select 'playmaker'::text, player_id, assists::numeric from s where assists > 0
     order by assists desc, appearances asc, joined_at asc limit 1)
    union all
    (select 'golden_glove'::text, player_id, clean_sheets::numeric from s where clean_sheets > 0
     order by clean_sheets desc, appearances asc, joined_at asc limit 1)
    union all
    (select 'iron_man'::text, player_id, appearances::numeric from s where appearances > 0
     order by appearances desc, joined_at asc limit 1)
    union all
    (select 'most_punctual'::text, player_id, punctuality_score::numeric from s where punctuality_score > 0
     order by punctuality_score desc, appearances desc, joined_at asc limit 1)
    union all
    (select 'fan_favourite'::text, player_id, vote_points::numeric from s where vote_points > 0
     order by vote_points desc, total_points desc, joined_at asc limit 1)
  ),
  resolved as (
    select distinct on (w.code)
      w.code, w.player_id, w.value, at.id as award_type_id
    from winners w
    join public.award_types at
      on at.code = w.code
     and (at.organization_id = v_org or at.organization_id is null)
     and at.enabled
    order by w.code, (at.organization_id is null)
  )
  insert into public.awards (organization_id, period_id, award_type_id, player_id, value, breakdown)
  select
    v_org, p_period, w.award_type_id, w.player_id, w.value,
    jsonb_build_object(
      'stats', to_jsonb(st) - 'id' - 'organization_id' - 'period_id',
      'rules', (
        select jsonb_object_agg(event_type, points)
        from public.scoring_rules
        where organization_id = v_org and period_id = p_period and enabled
      ),
      'frozen_at', now()
    )
  from resolved w
  join public.player_period_stats st
    on st.player_id = w.player_id and st.period_id = p_period
  on conflict (organization_id, period_id, award_type_id) do nothing;

  -- 4. Lock it.
  update public.periods
  set status = 'closed', closed_at = now(), closed_by = p_actor,
      auto_close_blocked_at = null, auto_close_blocked_reason = null
  where id = p_period;

  -- 5. Freeze the month's report. Runs after the lock so it reports the month
  --    as closed, with its awards already in place.
  v_report := public.store_period_report(p_period);

  -- 6. Open the next month so recording can continue immediately.
  select (ends_on + interval '1 day')::date into v_next_date
  from public.periods where id = p_period;

  insert into public.periods (
    organization_id, season_id, label, year, month, starts_on, ends_on, status
  ) values (
    v_org, v_season,
    to_char(v_next_date, 'FMMonth YYYY'),
    extract(year from v_next_date)::int,
    extract(month from v_next_date)::int,
    date_trunc('month', v_next_date)::date,
    (date_trunc('month', v_next_date) + interval '1 month - 1 day')::date,
    'open'
  )
  on conflict (organization_id, year, month) do update set status = 'open'
  returning id into v_next;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id)
  values (v_org, p_actor, 'period.close', 'period', p_period);

  select jsonb_agg(jsonb_build_object(
    'code', at.code, 'name', at.name, 'icon', at.icon,
    'player_id', a.player_id, 'value', a.value
  ))
  into v_awards
  from public.awards a
  join public.award_types at on at.id = a.award_type_id
  where a.period_id = p_period;

  return jsonb_build_object(
    'period_id', p_period,
    'next_period_id', v_next,
    'awards', coalesce(v_awards, '[]'::jsonb),
    'headlines', coalesce(v_report -> 'headlines', '[]'::jsonb)
  );
end;
$fn$;
