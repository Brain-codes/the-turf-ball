-- ============================================================================
-- The Turf Ball — statistics, scoring and period-close engine
-- SPEC.md §9
--
-- These live in the database rather than in TypeScript for two reasons:
-- aggregation belongs next to the data, and period close must be transactional
-- (a half-closed month with awards but no locked period is unrecoverable).
--
-- Edge Functions call these via RPC using the service role. Clients never do.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Default scoring rules for a new organization (Balanced preset)
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_scoring_rules(p_org uuid)
returns void
language sql
as $$
  insert into public.scoring_rules (organization_id, period_id, event_type, points, enabled)
  values
    (p_org, null, 'appearance',   1, true),
    (p_org, null, 'goal',         5, true),
    (p_org, null, 'assist',       3, true),
    (p_org, null, 'clean_sheet',  2, true),
    (p_org, null, 'own_goal',    -2, true),
    (p_org, null, 'yellow_card', -1, true),
    (p_org, null, 'red_card',    -3, true),
    (p_org, null, 'save',         0, false),
    (p_org, null, 'motm',         0, false),
    (p_org, null, 'punctuality',  1, true)
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Ensure an open period exists for an organization, and return it.
-- Called before anything that needs to attach to a period.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_open_period(p_org uuid)
returns uuid
language plpgsql
as $$
declare
  v_period uuid;
  v_season uuid;
  v_now    date;
  v_tz     text;
begin
  select timezone into v_tz from public.organizations where id = p_org;
  v_now := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  select id into v_period
  from public.periods
  where organization_id = p_org and status = 'open'
  limit 1;

  if v_period is not null then
    return v_period;
  end if;

  select id into v_season
  from public.seasons
  where organization_id = p_org and is_current
  limit 1;

  if v_season is null then
    insert into public.seasons (organization_id, name, starts_on, is_current)
    values (p_org, to_char(v_now, 'YYYY'), date_trunc('year', v_now)::date, true)
    returning id into v_season;
  end if;

  insert into public.periods (
    organization_id, season_id, label, year, month, starts_on, ends_on, status
  ) values (
    p_org,
    v_season,
    to_char(v_now, 'FMMonth YYYY'),
    extract(year from v_now)::int,
    extract(month from v_now)::int,
    date_trunc('month', v_now)::date,
    (date_trunc('month', v_now) + interval '1 month - 1 day')::date,
    'open'
  )
  on conflict (organization_id, year, month) do update set status = 'open'
  returning id into v_period;

  return v_period;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh the cached scoreline on a match from its events.
-- Own goals credit the opposing side — the scorer keeps the own_goal against
-- their own record, but the goal counts for the other team.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_match_score(p_match uuid)
returns void
language sql
as $$
  update public.matches m
  set side_a_score = coalesce(s.a, 0),
      side_b_score = coalesce(s.b, 0)
  from (
    select
      count(*) filter (
        where (e.event_type = 'goal' and e.side = 'a')
           or (e.event_type = 'own_goal' and e.side = 'b')
      ) as a,
      count(*) filter (
        where (e.event_type = 'goal' and e.side = 'b')
           or (e.event_type = 'own_goal' and e.side = 'a')
      ) as b
    from public.match_events e
    where e.match_id = p_match and e.voided_at is null
  ) s
  where m.id = p_match;
$$;

-- ---------------------------------------------------------------------------
-- Recompute every player's statistics and points for a period.
--
-- Source of truth is match_events (excluding voided) plus session_attendance
-- for punctuality and match_players for appearances. Nothing here reads a
-- previously stored statistic — a full recompute is always correct, which is
-- what makes drift impossible.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_period_stats(p_period uuid)
returns integer
language plpgsql
as $$
declare
  v_org        uuid;
  v_use_period uuid;
  v_count      integer;
begin
  select organization_id into v_org from public.periods where id = p_period;
  if v_org is null then
    raise exception 'Period % not found', p_period;
  end if;

  -- A closed period uses its frozen rule snapshot; an open one uses defaults.
  select case
           when exists (
             select 1 from public.scoring_rules
             where organization_id = v_org and period_id = p_period
           ) then p_period
           else null
         end
    into v_use_period;

  with rules as (
    select event_type, points
    from public.scoring_rules
    where organization_id = v_org
      and enabled
      and period_id is not distinct from v_use_period
  ),
  -- Appearances come from match rosters, not from an event.
  apps as (
    select mp.player_id, count(distinct mp.match_id)::int as n
    from public.match_players mp
    join public.matches mt on mt.id = mp.match_id
    join public.sessions s on s.id = mt.session_id
    where s.period_id = p_period
      and mt.status in ('completed', 'live')
    group by mp.player_id
  ),
  ev as (
    select
      player_id,
      count(*) filter (where event_type = 'goal')        ::int as goals,
      count(*) filter (where event_type = 'own_goal')    ::int as own_goals,
      count(*) filter (where event_type = 'assist')      ::int as assists,
      count(*) filter (where event_type = 'clean_sheet') ::int as clean_sheets,
      count(*) filter (where event_type = 'yellow_card') ::int as yellows,
      count(*) filter (where event_type = 'red_card')    ::int as reds,
      count(*) filter (where event_type = 'save')        ::int as saves
    from public.match_events
    where period_id = p_period and voided_at is null
    group by player_id
  ),
  punc as (
    select a.player_id, sum(a.punctuality_points)::numeric as pts
    from public.session_attendance a
    join public.sessions s on s.id = a.session_id
    where s.period_id = p_period and a.status = 'present'
    group by a.player_id
  ),
  votes as (
    select player_id, sum(weight)::numeric as pts
    from public.award_votes
    where period_id = p_period
    group by player_id
  ),
  merged as (
    select
      p.id as player_id,
      coalesce(apps.n, 0)            as appearances,
      coalesce(ev.goals, 0)          as goals,
      coalesce(ev.own_goals, 0)      as own_goals,
      coalesce(ev.assists, 0)        as assists,
      coalesce(ev.clean_sheets, 0)   as clean_sheets,
      coalesce(ev.yellows, 0)        as yellow_cards,
      coalesce(ev.reds, 0)           as red_cards,
      coalesce(ev.saves, 0)          as saves,
      coalesce(punc.pts, 0)          as punctuality_score,
      coalesce(votes.pts, 0)         as vote_points
    from public.players p
    left join apps  on apps.player_id  = p.id
    left join ev    on ev.player_id    = p.id
    left join punc  on punc.player_id  = p.id
    left join votes on votes.player_id = p.id
    where p.organization_id = v_org
  ),
  scored as (
    select
      m.*,
      (
        m.appearances  * coalesce((select points from rules where event_type = 'appearance'),  0) +
        m.goals        * coalesce((select points from rules where event_type = 'goal'),        0) +
        m.own_goals    * coalesce((select points from rules where event_type = 'own_goal'),    0) +
        m.assists      * coalesce((select points from rules where event_type = 'assist'),      0) +
        m.clean_sheets * coalesce((select points from rules where event_type = 'clean_sheet'), 0) +
        m.yellow_cards * coalesce((select points from rules where event_type = 'yellow_card'), 0) +
        m.red_cards    * coalesce((select points from rules where event_type = 'red_card'),    0) +
        m.saves        * coalesce((select points from rules where event_type = 'save'),        0) +
        m.punctuality_score +
        m.vote_points
      )::numeric(10,2) as total_points
    from merged m
  ),
  ranked as (
    select
      s.*,
      -- Tie-breakers in the order fixed by SPEC.md §9.6. joined_at is the
      -- deterministic final fallback so a tie is never a coin flip.
      row_number() over (
        order by s.total_points desc,
                 s.goals desc,
                 s.assists desc,
                 s.red_cards asc,
                 s.yellow_cards asc,
                 s.appearances desc,
                 s.punctuality_score desc,
                 p.joined_at asc
      )::int as rnk
    from scored s
    join public.players p on p.id = s.player_id
  )
  insert into public.player_period_stats (
    organization_id, period_id, player_id, appearances, goals, own_goals, assists,
    clean_sheets, yellow_cards, red_cards, saves, punctuality_score, vote_points,
    total_points, rank, computed_at
  )
  select
    v_org, p_period, r.player_id, r.appearances, r.goals, r.own_goals, r.assists,
    r.clean_sheets, r.yellow_cards, r.red_cards, r.saves, r.punctuality_score,
    r.vote_points, r.total_points, r.rnk, now()
  from ranked r
  on conflict (organization_id, period_id, player_id) do update set
    appearances       = excluded.appearances,
    goals             = excluded.goals,
    own_goals         = excluded.own_goals,
    assists           = excluded.assists,
    clean_sheets      = excluded.clean_sheets,
    yellow_cards      = excluded.yellow_cards,
    red_cards         = excluded.red_cards,
    saves             = excluded.saves,
    punctuality_score = excluded.punctuality_score,
    vote_points       = excluded.vote_points,
    total_points      = excluded.total_points,
    rank              = excluded.rank,
    computed_at       = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Close a period. Transactional and irreversible without an explicit reopen.
-- SPEC.md §9.7 — the order of these steps matters.
-- ---------------------------------------------------------------------------
create or replace function public.close_period(p_period uuid, p_actor uuid)
returns jsonb
language plpgsql
as $$
declare
  v_org       uuid;
  v_status    period_status;
  v_live      integer;
  v_next      uuid;
  v_next_date date;
  v_season    uuid;
  v_awards    jsonb;
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

  -- A live session means someone is still recording. Closing now would strand
  -- their events in a locked month.
  select count(*) into v_live
  from public.sessions
  where period_id = p_period and status = 'live';
  if v_live > 0 then
    raise exception 'Cannot close: % session(s) still live', v_live;
  end if;

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
  -- Each branch needs its own parentheses: an unparenthesised ORDER BY/LIMIT
  -- inside a UNION applies to the whole union, not the branch.
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
  -- An organization may override a system award type with its own of the same
  -- code; distinct on picks the org's version and never awards both.
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
  set status = 'closed', closed_at = now(), closed_by = p_actor
  where id = p_period;

  -- 5. Open the next month so recording can continue immediately.
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
    'awards', coalesce(v_awards, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reopen a closed period. Audited, because it rewrites history.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_period(p_period uuid, p_actor uuid)
returns void
language plpgsql
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.periods where id = p_period;
  if v_org is null then raise exception 'Period not found'; end if;

  -- Only one period may be open at a time.
  update public.periods set status = 'closed', closed_at = now()
  where organization_id = v_org and status = 'open' and id <> p_period;

  delete from public.awards where period_id = p_period;
  delete from public.scoring_rules where period_id = p_period;

  update public.periods
  set status = 'open', closed_at = null, closed_by = null
  where id = p_period;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id)
  values (v_org, p_actor, 'period.reopen', 'period', p_period);
end;
$$;

-- ---------------------------------------------------------------------------
-- Integrity check — the cache must never disagree with the source of truth.
-- Scheduled to run periodically; any row returned is a bug worth an alert.
-- ---------------------------------------------------------------------------
create or replace function public.check_stats_drift(p_period uuid)
returns table (player_id uuid, field text, cached integer, actual integer)
language sql
as $$
  with actual as (
    select
      player_id,
      count(*) filter (where event_type = 'goal')::int   as goals,
      count(*) filter (where event_type = 'assist')::int as assists
    from public.match_events
    where period_id = p_period and voided_at is null
    group by player_id
  )
  select s.player_id, 'goals', s.goals, coalesce(a.goals, 0)
  from public.player_period_stats s
  left join actual a on a.player_id = s.player_id
  where s.period_id = p_period and s.goals <> coalesce(a.goals, 0)
  union all
  select s.player_id, 'assists', s.assists, coalesce(a.assists, 0)
  from public.player_period_stats s
  left join actual a on a.player_id = s.player_id
  where s.period_id = p_period and s.assists <> coalesce(a.assists, 0);
$$;

-- ---------------------------------------------------------------------------
-- Atomic view counter. Twenty people opening the WhatsApp link at once must
-- not overwrite each other with a read-modify-write.
-- ---------------------------------------------------------------------------
create or replace function public.increment_page_view(p_org uuid)
returns void
language sql
as $$
  update public.public_pages
  set view_count = view_count + 1
  where organization_id = p_org;
$$;
