-- ============================================================================
-- Position-based points, and two per-month switches.
--
-- Defenders complained that a forward, standing nearest the goal, will always
-- out-score them. So a goal or an assist can now be worth more the further
-- back the player is registered:
--
--   line  | positions                  | goal | assist   (starting values)
--   FWD   | LW RW ST CF (and no pos.)  | base | base
--   MID   | CDM CM CAM LM RM           | +1   | base
--   DEF   | RB CB LB                   | +2   | +1
--   GK    | GK                         | +2   | +1       (paid like defenders)
--
-- "base" is whatever the group's goal/assist rule was when this ran, so the
-- live 5/3 becomes FWD 5/3, MID 6/3, DEF 7/4, GK 7/4. All editable.
--
-- Clean sheets are untouched: still recorded by hand for whoever was in goal.
--
-- Two switches live on each month (periods), not on the group, so a month can
-- be flipped on its own and a closed month keeps what it was scored under:
--
--   positional_scoring   — off: the old flat points. on: the table above.
--   attendance_tracking  — off: nobody is marked early/late; everyone who
--                          played a session is credited the "early" points
--                          for it, and Most Punctual is not awarded.
--
-- Both totals are always computed and stored (standard_points,
-- positional_points). total_points is simply whichever the month's switch
-- picks, so every screen, report and award that reads total_points follows
-- the switch with no change of its own, and flipping it back is lossless.
--
-- A new month inherits both switches from the month before it.
--
-- A player's line is taken from their position at recompute time, and stored
-- on their stats row. Once a month is closed the stored line is used, so
-- changing someone's position in October never rescores September.
-- ============================================================================

-- 1. Which line a position belongs to ----------------------------------------
create or replace function public.position_line(p public.player_position)
returns text
language sql
immutable
as $$
  select case
    when p = 'GK' then 'GK'
    when p in ('RB', 'CB', 'LB') then 'DEF'
    when p in ('CDM', 'CM', 'CAM', 'LM', 'RM') then 'MID'
    else 'FWD'
  end;
$$;

-- 2. Points per line ---------------------------------------------------------
-- period_id null = the group's live values; set = frozen when the month closed.
create table if not exists public.position_points (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id       uuid references public.periods(id) on delete cascade,
  line            text not null check (line in ('FWD', 'MID', 'DEF', 'GK')),
  event_type      event_type not null check (event_type in ('goal', 'assist')),
  points          numeric(6,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists position_points_default_uniq
  on public.position_points(organization_id, line, event_type)
  where period_id is null;

create unique index if not exists position_points_period_uniq
  on public.position_points(organization_id, period_id, line, event_type)
  where period_id is not null;

create trigger position_points_touch before update on public.position_points
  for each row execute function public.touch_updated_at();

alter table public.position_points enable row level security;
alter table public.position_points force row level security;

create or replace function public.seed_default_position_points(p_org uuid)
returns void
language sql
as $$
  with base as (
    select
      coalesce((select points from public.scoring_rules
                where organization_id = p_org and period_id is null and event_type = 'goal'), 5) as goal,
      coalesce((select points from public.scoring_rules
                where organization_id = p_org and period_id is null and event_type = 'assist'), 3) as assist
  )
  insert into public.position_points (organization_id, period_id, line, event_type, points)
  select p_org, null, v.line, v.event_type::event_type, v.points
  from base,
  lateral (values
    ('FWD', 'goal',   base.goal),
    ('MID', 'goal',   base.goal + 1),
    ('DEF', 'goal',   base.goal + 2),
    ('GK',  'goal',   base.goal + 2),
    ('FWD', 'assist', base.assist),
    ('MID', 'assist', base.assist),
    ('DEF', 'assist', base.assist + 1),
    ('GK',  'assist', base.assist + 1)
  ) as v(line, event_type, points)
  on conflict do nothing;
$$;

-- New groups get both sets of defaults from the one call create.ts makes.
create or replace function public.seed_default_scoring_rules(p_org uuid)
returns void
language sql
as $$
  insert into public.scoring_rules (organization_id, period_id, event_type, points, enabled)
  values
    (p_org, null, 'appearance',    1, true),
    (p_org, null, 'goal',          5, true),
    (p_org, null, 'assist',        3, true),
    (p_org, null, 'clean_sheet',   2, true),
    (p_org, null, 'penalty_save',  3, true),
    (p_org, null, 'own_goal',     -2, true),
    (p_org, null, 'yellow_card',  -1, true),
    (p_org, null, 'red_card',     -3, true),
    (p_org, null, 'save',          0, false),
    (p_org, null, 'motm',          0, false),
    (p_org, null, 'punctuality',   1, true)
  on conflict do nothing;

  select public.seed_default_position_points(p_org);
$$;

select public.seed_default_position_points(o.id) from public.organizations o;

-- 3. The two monthly switches --------------------------------------------------
alter table public.periods
  add column if not exists positional_scoring  boolean not null default false,
  add column if not exists attendance_tracking boolean not null default true;

-- Carry the switches forward from the org's latest earlier month. One trigger
-- covers every place a month gets created (close_period, ensure_open_period,
-- period_for_date).
create or replace function public.periods_inherit_switches()
returns trigger
language plpgsql
as $$
declare
  v_pos boolean;
  v_att boolean;
begin
  select positional_scoring, attendance_tracking
    into v_pos, v_att
  from public.periods
  where organization_id = new.organization_id
    and (year, month) < (new.year, new.month)
  order by year desc, month desc
  limit 1;

  if found then
    new.positional_scoring  := v_pos;
    new.attendance_tracking := v_att;
  end if;
  return new;
end;
$$;

drop trigger if exists periods_inherit_switches on public.periods;
create trigger periods_inherit_switches before insert on public.periods
  for each row execute function public.periods_inherit_switches();

-- 4. Both totals on the stats row -----------------------------------------------
alter table public.player_period_stats
  add column if not exists standard_points   numeric(10,2) not null default 0,
  add column if not exists positional_points numeric(10,2) not null default 0,
  add column if not exists position_line     text;

-- 5. Reopening a month thaws its position points too -----------------------------
create or replace function public.reopen_period(p_period uuid, p_actor uuid)
returns void
language plpgsql
as $fn$
declare v_org uuid;
begin
  select organization_id into v_org from public.periods where id = p_period;
  if v_org is null then raise exception 'Period not found'; end if;

  -- Only one period may be open at a time.
  update public.periods set status = 'closed', closed_at = now()
  where organization_id = v_org and status = 'open' and id <> p_period;

  delete from public.awards where period_id = p_period;
  delete from public.scoring_rules where period_id = p_period;
  delete from public.position_points where period_id = p_period;
  delete from public.period_reports where period_id = p_period;

  update public.periods
  set status = 'open', closed_at = null, closed_by = null,
      closed_automatically = false,
      auto_close_blocked_at = null, auto_close_blocked_reason = null
  where id = p_period;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id)
  values (v_org, p_actor, 'period.reopen', 'period', p_period);
end;
$fn$;

-- 6. The engine ------------------------------------------------------------------
-- Based on 20260906030000_cancelled_sessions_count_nothing.sql. Changes:
-- position points, the attendance switch, and the two stored totals.
create or replace function public.recompute_period_stats(p_period uuid)
returns integer
language plpgsql
as $$
declare
  v_org        uuid;
  v_closed     boolean;
  v_positional boolean;
  v_attendance boolean;
  v_early      numeric;
  v_use_period uuid;
  v_pos_period uuid;
  v_count      integer;
begin
  select organization_id, status = 'closed', positional_scoring, attendance_tracking
    into v_org, v_closed, v_positional, v_attendance
  from public.periods where id = p_period;
  if v_org is null then
    raise exception 'Period % not found', p_period;
  end if;

  select coalesce(early_points, 0) into v_early
  from public.org_settings where organization_id = v_org;
  v_early := coalesce(v_early, 0);

  select case
           when exists (
             select 1 from public.scoring_rules
             where organization_id = v_org and period_id = p_period
           ) then p_period
           else null
         end
    into v_use_period;

  select case
           when exists (
             select 1 from public.position_points
             where organization_id = v_org and period_id = p_period
           ) then p_period
           else null
         end
    into v_pos_period;

  with rules as (
    select event_type, points
    from public.scoring_rules
    where organization_id = v_org
      and enabled
      and period_id is not distinct from v_use_period
  ),
  pos_rules as (
    select line, event_type, points
    from public.position_points
    where organization_id = v_org
      and period_id is not distinct from v_pos_period
  ),
  apps as (
    select mp.player_id, count(distinct mp.match_id)::int as n
    from public.match_players mp
    join public.matches mt on mt.id = mp.match_id
    left join public.sessions s on s.id = mt.session_id
    left join public.competition_fixtures cf on cf.id = mt.competition_fixture_id
    left join public.competitions c on c.id = cf.competition_id
    where mt.status in ('completed', 'live')
      and coalesce(s.status::text, '') <> 'cancelled'
      and coalesce(
            s.period_id,
            case when c.id is not null and c.count_toward_stats then c.period_id end
          ) = p_period
    group by mp.player_id
  ),
  ev as (
    select
      player_id,
      count(*) filter (where event_type = 'goal')         ::int as goals,
      count(*) filter (where event_type = 'own_goal')     ::int as own_goals,
      count(*) filter (where event_type = 'assist')       ::int as assists,
      count(*) filter (where event_type = 'clean_sheet')  ::int as clean_sheets,
      count(*) filter (where event_type = 'yellow_card')  ::int as yellows,
      count(*) filter (where event_type = 'red_card')     ::int as reds,
      count(*) filter (where event_type = 'save')         ::int as saves,
      count(*) filter (where event_type = 'penalty_save') ::int as penalty_saves
    from public.match_events me
    left join public.competitions c on c.id = me.competition_id
    left join public.matches mt on mt.id = me.match_id
    left join public.sessions s on s.id = mt.session_id
    where me.period_id = p_period
      and me.voided_at is null
      and (me.competition_id is null or c.count_toward_stats)
      and coalesce(s.status::text, '') <> 'cancelled'
    group by player_id
  ),
  -- Attendance on: what was recorded at the gate.
  -- Attendance off: every session a player was at counts as an early arrival.
  punc as (
    select a.player_id, sum(a.punctuality_points)::numeric as pts
    from public.session_attendance a
    join public.sessions s on s.id = a.session_id
    where v_attendance
      and s.period_id = p_period and a.status = 'present'
      and s.status <> 'cancelled'
    group by a.player_id
    union all
    select x.player_id, (count(distinct x.session_id) * v_early)::numeric
    from (
      select a.player_id, a.session_id
      from public.session_attendance a
      join public.sessions s on s.id = a.session_id
      where s.period_id = p_period and a.status = 'present' and s.status <> 'cancelled'
      union
      select mp.player_id, mt.session_id
      from public.match_players mp
      join public.matches mt on mt.id = mp.match_id
      join public.sessions s on s.id = mt.session_id
      where s.period_id = p_period and s.status <> 'cancelled'
        and mt.status in ('completed', 'live')
    ) x
    where not v_attendance
    group by x.player_id
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
      -- A closed month keeps the line it was scored with.
      case
        when v_closed and old.position_line is not null then old.position_line
        else public.position_line(p.position)
      end                             as position_line,
      coalesce(apps.n, 0)             as appearances,
      coalesce(ev.goals, 0)           as goals,
      coalesce(ev.own_goals, 0)       as own_goals,
      coalesce(ev.assists, 0)         as assists,
      coalesce(ev.clean_sheets, 0)    as clean_sheets,
      coalesce(ev.yellows, 0)         as yellow_cards,
      coalesce(ev.reds, 0)            as red_cards,
      coalesce(ev.saves, 0)           as saves,
      coalesce(ev.penalty_saves, 0)   as penalty_saves,
      coalesce(punc.pts, 0)           as punctuality_score,
      coalesce(votes.pts, 0)          as vote_points
    from public.players p
    left join apps  on apps.player_id  = p.id
    left join ev    on ev.player_id    = p.id
    left join punc  on punc.player_id  = p.id
    left join votes on votes.player_id = p.id
    left join public.player_period_stats old
      on old.period_id = p_period and old.player_id = p.id
    where p.organization_id = v_org
  ),
  common as (
    select
      m.*,
      (
        m.appearances   * coalesce((select points from rules where event_type = 'appearance'),   0) +
        m.own_goals     * coalesce((select points from rules where event_type = 'own_goal'),     0) +
        m.clean_sheets  * coalesce((select points from rules where event_type = 'clean_sheet'),  0) +
        m.yellow_cards  * coalesce((select points from rules where event_type = 'yellow_card'),  0) +
        m.red_cards     * coalesce((select points from rules where event_type = 'red_card'),     0) +
        m.saves         * coalesce((select points from rules where event_type = 'save'),         0) +
        m.penalty_saves * coalesce((select points from rules where event_type = 'penalty_save'), 0) +
        m.punctuality_score +
        m.vote_points
      ) as shared_pts
    from merged m
  ),
  both_totals as (
    select
      c.*,
      (c.shared_pts
        + c.goals   * coalesce((select points from rules where event_type = 'goal'),   0)
        + c.assists * coalesce((select points from rules where event_type = 'assist'), 0)
      )::numeric(10,2) as standard_points,
      (c.shared_pts
        -- A disabled goal/assist rule switches that event off in both modes.
        + case when exists (select 1 from rules where event_type = 'goal')
            then c.goals * coalesce((select points from pos_rules pr
                                     where pr.line = c.position_line and pr.event_type = 'goal'), 0)
            else 0 end
        + case when exists (select 1 from rules where event_type = 'assist')
            then c.assists * coalesce((select points from pos_rules pr
                                       where pr.line = c.position_line and pr.event_type = 'assist'), 0)
            else 0 end
      )::numeric(10,2) as positional_points
    from common c
  ),
  scored as (
    select
      b.*,
      case when v_positional then b.positional_points else b.standard_points end as total_points
    from both_totals b
  ),
  ranked as (
    select
      s.*,
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
    clean_sheets, yellow_cards, red_cards, saves, penalty_saves, punctuality_score,
    vote_points, standard_points, positional_points, position_line,
    total_points, rank, computed_at
  )
  select
    v_org, p_period, r.player_id, r.appearances, r.goals, r.own_goals, r.assists,
    r.clean_sheets, r.yellow_cards, r.red_cards, r.saves, r.penalty_saves,
    r.punctuality_score, r.vote_points, r.standard_points, r.positional_points,
    r.position_line, r.total_points, r.rnk, now()
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
    penalty_saves     = excluded.penalty_saves,
    punctuality_score = excluded.punctuality_score,
    vote_points       = excluded.vote_points,
    standard_points   = excluded.standard_points,
    positional_points = excluded.positional_points,
    position_line     = excluded.position_line,
    total_points      = excluded.total_points,
    rank              = excluded.rank,
    computed_at       = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 7. Closing a month also freezes the position points ------------------------------
-- Based on 20260906020000_close_month_tidies_sessions.sql. Changes: step 1b,
-- Most Punctual skipped with attendance off, and the switches and position
-- points recorded in each award's frozen breakdown.
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

  -- 1b. Same for the per-position goal and assist points.
  insert into public.position_points (organization_id, period_id, line, event_type, points)
  select organization_id, p_period, line, event_type, points
  from public.position_points
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
    -- With attendance switched off everyone is credited as early, so there is
    -- no punctuality race to win.
    (select 'most_punctual'::text, player_id, punctuality_score::numeric from s
     where punctuality_score > 0
       and (select attendance_tracking from public.periods where id = p_period)
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
      'position_points', (
        select jsonb_object_agg(line || '_' || event_type, points)
        from public.position_points
        where organization_id = v_org and period_id = p_period
      ),
      'positional_scoring', (select positional_scoring from public.periods where id = p_period),
      'attendance_tracking', (select attendance_tracking from public.periods where id = p_period),
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

-- 8. Backfill ---------------------------------------------------------------------
-- Closed months keep their numbers exactly; their flat total is the standard one.
update public.player_period_stats
set standard_points = total_points
where standard_points = 0 and total_points <> 0;

-- Months still in play get both totals worked out now.
select public.recompute_period_stats(p.id)
from public.periods p
where p.status <> 'closed';
