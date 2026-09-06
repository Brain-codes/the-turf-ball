-- ---------------------------------------------------------------------------
-- Penalty saves as a tracked statistic, and clean sheets anyone can record.
--
-- Two changes, one theme: in 5-a-side there is no permanent goalkeeper. Whoever
-- goes in goal for ten minutes and stops a penalty deserves the credit, and
-- whoever is between the sticks at full time deserves the clean sheet. Neither
-- can be derived from a roster flag nobody sets, so both become things the
-- recorder taps for any player on the pitch.
--
--   * penalty_saves — a brand-new counted event and stat column.
--   * clean sheets  — still auto-awarded by policy, but a manually recorded
--                     one now survives a match being finished (and re-finished).
-- ---------------------------------------------------------------------------

-- 1. Stat cache column -------------------------------------------------------
alter table public.player_period_stats
  add column if not exists penalty_saves integer not null default 0;

-- 2. Per-group toggle, matching track_clean_sheets ---------------------------
alter table public.org_settings
  add column if not exists track_penalty_saves boolean not null default true;

-- 3. A player cannot keep two clean sheets in the same match. The auto-award
--    path already replaces rather than appends; this stops a double tap on the
--    new manual button from doing what the auto path is careful not to.
create unique index if not exists match_events_one_clean_sheet_per_match
  on public.match_events(match_id, player_id)
  where event_type = 'clean_sheet' and voided_at is null;

-- 4. Default scoring weight for new groups ----------------------------------
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
$$;

-- Backfill the new rule for every existing group's live defaults. Frozen
-- per-period snapshots are deliberately left alone — a closed month keeps the
-- rules it was scored under.
insert into public.scoring_rules (organization_id, period_id, event_type, points, enabled)
select o.id, null, 'penalty_save', 3, true
from public.organizations o
where not exists (
  select 1 from public.scoring_rules r
  where r.organization_id = o.id and r.period_id is null and r.event_type = 'penalty_save'
);

-- 5. The engine --------------------------------------------------------------
-- Same shape as the version in 20260820000000_competitions.sql, with
-- penalty_saves threaded through the event roll-up, the points sum and the
-- cache write.
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
  apps as (
    select mp.player_id, count(distinct mp.match_id)::int as n
    from public.match_players mp
    join public.matches mt on mt.id = mp.match_id
    left join public.sessions s on s.id = mt.session_id
    left join public.competition_fixtures cf on cf.id = mt.competition_fixture_id
    left join public.competitions c on c.id = cf.competition_id
    where mt.status in ('completed', 'live')
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
    where me.period_id = p_period
      and me.voided_at is null
      and (me.competition_id is null or c.count_toward_stats)
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
    where p.organization_id = v_org
  ),
  scored as (
    select
      m.*,
      (
        m.appearances   * coalesce((select points from rules where event_type = 'appearance'),   0) +
        m.goals         * coalesce((select points from rules where event_type = 'goal'),         0) +
        m.own_goals     * coalesce((select points from rules where event_type = 'own_goal'),     0) +
        m.assists       * coalesce((select points from rules where event_type = 'assist'),       0) +
        m.clean_sheets  * coalesce((select points from rules where event_type = 'clean_sheet'),  0) +
        m.yellow_cards  * coalesce((select points from rules where event_type = 'yellow_card'),  0) +
        m.red_cards     * coalesce((select points from rules where event_type = 'red_card'),     0) +
        m.saves         * coalesce((select points from rules where event_type = 'save'),         0) +
        m.penalty_saves * coalesce((select points from rules where event_type = 'penalty_save'), 0) +
        m.punctuality_score +
        m.vote_points
      )::numeric(10,2) as total_points
    from merged m
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
    vote_points, total_points, rank, computed_at
  )
  select
    v_org, p_period, r.player_id, r.appearances, r.goals, r.own_goals, r.assists,
    r.clean_sheets, r.yellow_cards, r.red_cards, r.saves, r.penalty_saves,
    r.punctuality_score, r.vote_points, r.total_points, r.rnk, now()
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
    total_points      = excluded.total_points,
    rank              = excluded.rank,
    computed_at       = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 6. The "?" breakdown behind a player's stats -------------------------------
-- Return type gains a column, so the old signature has to go first.
drop function if exists public.player_stats_breakdown(uuid, uuid);

create function public.player_stats_breakdown(p_player uuid, p_period uuid)
returns table (
  source text,
  appearances bigint,
  goals bigint,
  own_goals bigint,
  assists bigint,
  clean_sheets bigint,
  yellow_cards bigint,
  red_cards bigint,
  saves bigint,
  penalty_saves bigint
)
language sql
stable
as $$
  with base as (
    select
      case when me.competition_id is null then 'session' else 'competition' end as source,
      me.event_type,
      me.match_id,
      me.player_id
    from public.match_events me
    left join public.competitions c on c.id = me.competition_id
    where me.period_id = p_period
      and me.player_id = p_player
      and me.voided_at is null
      and (me.competition_id is null or c.count_toward_stats)
  ),
  apps as (
    select
      case when mt.competition_fixture_id is null then 'session' else 'competition' end as source,
      count(distinct mp.match_id) as n
    from public.match_players mp
    join public.matches mt on mt.id = mp.match_id
    left join public.sessions s on s.id = mt.session_id
    left join public.competition_fixtures cf on cf.id = mt.competition_fixture_id
    left join public.competitions c on c.id = cf.competition_id
    where mp.player_id = p_player
      and mt.status in ('completed', 'live')
      and coalesce(
            s.period_id,
            case when c.id is not null and c.count_toward_stats then c.period_id end
          ) = p_period
    group by 1
  )
  select
    src.source,
    coalesce(apps.n, 0) as appearances,
    count(*) filter (where base.event_type = 'goal' and base.source = src.source)         as goals,
    count(*) filter (where base.event_type = 'own_goal' and base.source = src.source)     as own_goals,
    count(*) filter (where base.event_type = 'assist' and base.source = src.source)       as assists,
    count(*) filter (where base.event_type = 'clean_sheet' and base.source = src.source)  as clean_sheets,
    count(*) filter (where base.event_type = 'yellow_card' and base.source = src.source)  as yellow_cards,
    count(*) filter (where base.event_type = 'red_card' and base.source = src.source)     as red_cards,
    count(*) filter (where base.event_type = 'save' and base.source = src.source)         as saves,
    count(*) filter (where base.event_type = 'penalty_save' and base.source = src.source) as penalty_saves
  from (values ('session'), ('competition')) as src(source)
  left join apps on apps.source = src.source
  left join base on base.source = src.source
  group by src.source, apps.n;
$$;

-- 7. All-time rollups behind the global leaderboard --------------------------
-- Dropped rather than replaced: the new column belongs next to saves, and
-- create-or-replace can only append to the end of a view.
drop view if exists public.player_alltime_stats;
drop view if exists public.org_alltime_stats;

create view public.player_alltime_stats as
select
  s.organization_id,
  s.player_id,
  sum(s.appearances)    as appearances,
  sum(s.goals)          as goals,
  sum(s.own_goals)      as own_goals,
  sum(s.assists)        as assists,
  sum(s.clean_sheets)   as clean_sheets,
  sum(s.yellow_cards)   as yellow_cards,
  sum(s.red_cards)      as red_cards,
  sum(s.saves)          as saves,
  sum(s.penalty_saves)  as penalty_saves,
  count(distinct s.period_id) as periods_played,
  max(s.computed_at)    as last_computed_at
from public.player_period_stats s
group by s.organization_id, s.player_id;

create view public.org_alltime_stats as
select
  s.organization_id,
  sum(s.appearances)   as appearances,
  sum(s.goals)         as goals,
  sum(s.own_goals)     as own_goals,
  sum(s.assists)       as assists,
  sum(s.clean_sheets)  as clean_sheets,
  sum(s.yellow_cards)  as yellow_cards,
  sum(s.red_cards)     as red_cards,
  sum(s.saves)         as saves,
  sum(s.penalty_saves) as penalty_saves,
  count(distinct s.player_id) as player_count
from public.player_period_stats s
group by s.organization_id;

-- 8. Monthly report source view ----------------------------------------------
drop view if exists public.player_month_lines;

create view public.player_month_lines
with (security_invoker = true) as
select
  st.organization_id,
  st.period_id,
  st.player_id,
  coalesce(nullif(btrim(pl.whatsapp_nickname), ''), pl.display_name) as player_name,
  pl.display_name,
  pl.photo_url,
  pr.year,
  pr.month,
  pr.label            as month_label,
  pr.status           as period_status,
  pr.year * 12 + pr.month as month_seq,
  st.appearances,
  st.goals,
  st.assists,
  st.clean_sheets,
  st.saves,
  st.penalty_saves,
  st.yellow_cards,
  st.red_cards,
  st.punctuality_score,
  st.total_points,
  st.rank,
  st.goals + st.assists as contributions
from public.player_period_stats st
join public.periods pr on pr.id = st.period_id
join public.players  pl on pl.id = st.player_id
where st.appearances > 0;

-- 9. The month report itself -------------------------------------------------
-- Re-emitted from 20260825000000_monthly_report.sql with penalty saves carried
-- through the month table, the summary, the records, the milestones and the
-- all-time career tables.
create or replace function public.build_period_report(p_period uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid;
  v_year    int;
  v_month   int;
  v_label   text;
  v_seq     int;
  v_start   date;
  v_end     date;
  v_status  period_status;

  v_attendance    jsonb;
  v_perfect       jsonb;
  v_squad         int;
  v_summary       jsonb;
  v_totals        jsonb;
  v_awards        jsonb;
  v_records       jsonb;
  v_milestones    jsonb;
  v_doubles       jsonb;
  v_nominations   jsonb;
  v_potm          jsonb;
  v_month_records jsonb;
  v_alltime       jsonb;
  v_headlines     jsonb;
  v_sessions_n    int;
begin
  select organization_id, year, month, label, starts_on, ends_on, status
    into v_org, v_year, v_month, v_label, v_start, v_end, v_status
  from public.periods where id = p_period;

  if v_org is null then
    raise exception 'Month not found';
  end if;

  v_seq := v_year * 12 + v_month;

  -- 1. Sessions that actually happened -------------------------------------
  -- A scheduled session nobody turned up to is not part of the month's story.
  drop table if exists tmp_rep_sessions;
  create temp table tmp_rep_sessions on commit drop as
  select
    s.id,
    s.session_date,
    s.title,
    (select count(*) from public.session_attendance a
      where a.session_id = s.id and a.status = 'present')::int as attendees
  from public.sessions s
  where s.period_id = p_period
    and s.status <> 'cancelled';

  delete from tmp_rep_sessions t
  where t.attendees = 0
    and not exists (select 1 from public.matches m where m.session_id = t.id);

  select count(*) into v_sessions_n from tmp_rep_sessions;

  select jsonb_build_object(
    'session_count', v_sessions_n,
    'average', case when v_sessions_n = 0 then 0
                    else round(avg(attendees)::numeric, 1) end,
    'best', coalesce(max(attendees), 0),
    'lowest', coalesce(min(attendees), 0),
    'sessions', coalesce(
      jsonb_agg(jsonb_build_object(
        'session_id', id,
        'date', session_date,
        'title', title,
        'attendees', attendees
      ) order by session_date), '[]'::jsonb)
  )
  into v_attendance
  from tmp_rep_sessions;

  -- Everyone who made every single one.
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', x.player_id, 'player', x.player_name
         ) order by x.player_name), '[]'::jsonb)
  into v_perfect
  from (
    select a.player_id,
           coalesce(nullif(btrim(pl.whatsapp_nickname), ''), pl.display_name) as player_name
    from public.session_attendance a
    join tmp_rep_sessions s on s.id = a.session_id
    join public.players pl on pl.id = a.player_id
    where a.status = 'present'
    group by a.player_id, pl.whatsapp_nickname, pl.display_name
    having count(distinct a.session_id) = v_sessions_n and v_sessions_n > 0
  ) x;

  select count(*)::int into v_squad
  from public.players
  where organization_id = v_org and status = 'active';

  -- 2. This month's stats table --------------------------------------------
  drop table if exists tmp_rep_now;
  create temp table tmp_rep_now on commit drop as
  select * from public.player_month_lines where period_id = p_period;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', player_id,
           'player', player_name,
           'display_name', display_name,
           'photo_url', photo_url,
           'goals', goals,
           'assists', assists,
           'contributions', contributions,
           'clean_sheets', clean_sheets,
           'penalty_saves', penalty_saves,
           'appearances', appearances,
           'yellow_cards', yellow_cards,
           'red_cards', red_cards,
           'points', total_points,
           'rank', rank
         ) order by total_points desc, goals desc, assists desc), '[]'::jsonb)
  into v_totals
  from tmp_rep_now;

  select jsonb_build_object(
    'players', count(*),
    'goals', coalesce(sum(goals), 0),
    'assists', coalesce(sum(assists), 0),
    'clean_sheets', coalesce(sum(clean_sheets), 0),
    'penalty_saves', coalesce(sum(penalty_saves), 0),
    'appearances', coalesce(sum(appearances), 0),
    'matches', (select count(*) from public.matches m
                join tmp_rep_sessions s on s.id = m.session_id)
  )
  into v_summary
  from tmp_rep_now;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', at.code, 'name', at.name, 'icon', at.icon,
           'player_id', a.player_id,
           'player', coalesce(nullif(btrim(pl.whatsapp_nickname), ''), pl.display_name),
           'photo_url', pl.photo_url,
           'value', a.value
         ) order by at.sort_order), '[]'::jsonb)
  into v_awards
  from public.awards a
  join public.award_types at on at.id = a.award_type_id
  join public.players pl on pl.id = a.player_id
  where a.period_id = p_period;

  -- 3. Every player-month, unpivoted, so records are one query not six ------
  drop table if exists tmp_rep_values;
  create temp table tmp_rep_values on commit drop as
  select
    l.player_id, l.player_name, l.month_seq, l.month_label, l.appearances,
    v.metric, v.metric_label, v.value
  from public.player_month_lines l
  cross join lateral (values
    ('goals',         'goals in a month',              l.goals::numeric),
    ('assists',       'assists in a month',            l.assists::numeric),
    ('contributions', 'goal contributions in a month', l.contributions::numeric),
    ('clean_sheets',  'clean sheets in a month',       l.clean_sheets::numeric),
    ('penalty_saves', 'penalty saves in a month',      l.penalty_saves::numeric),
    ('appearances',   'appearances in a month',        l.appearances::numeric),
    ('points',        'points in a month',             l.total_points)
  ) as v(metric, metric_label, value)
  where l.organization_id = v_org and l.month_seq <= v_seq;

  -- Records broken this month: this month's best beats everything before it.
  with now_best as (
    select distinct on (metric)
      metric, metric_label, player_id, player_name, value, appearances
    from tmp_rep_values
    where month_seq = v_seq and value > 0
    order by metric, value desc, appearances asc
  ),
  prior_best as (
    select distinct on (metric)
      metric, player_id, player_name, value, appearances, month_label
    from tmp_rep_values
    where month_seq < v_seq and value > 0
    order by metric, value desc, appearances asc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'month_record',
           'metric', n.metric,
           'metric_label', n.metric_label,
           'player_id', n.player_id,
           'player', n.player_name,
           'value', n.value,
           'appearances', n.appearances,
           'first_ever', p.metric is null,
           'previous', case when p.metric is null then null else jsonb_build_object(
             'player', p.player_name, 'value', p.value,
             'appearances', p.appearances, 'month', p.month_label
           ) end
         ) order by n.metric), '[]'::jsonb)
  into v_records
  from now_best n
  left join prior_best p on p.metric = n.metric
  where p.metric is null or n.value > p.value;

  -- 4. Career totals, before and after this month --------------------------
  drop table if exists tmp_rep_career;
  create temp table tmp_rep_career on commit drop as
  select
    l.player_id,
    max(l.player_name) as player_name,
    coalesce(sum(l.goals)         filter (where l.month_seq < v_seq), 0)::int as prior_goals,
    coalesce(sum(l.assists)       filter (where l.month_seq < v_seq), 0)::int as prior_assists,
    coalesce(sum(l.contributions) filter (where l.month_seq < v_seq), 0)::int as prior_contributions,
    coalesce(sum(l.appearances)   filter (where l.month_seq < v_seq), 0)::int as prior_appearances,
    coalesce(sum(l.clean_sheets)  filter (where l.month_seq < v_seq), 0)::int as prior_clean_sheets,
    coalesce(sum(l.penalty_saves) filter (where l.month_seq < v_seq), 0)::int as prior_penalty_saves,
    coalesce(sum(l.goals), 0)::int         as goals,
    coalesce(sum(l.assists), 0)::int       as assists,
    coalesce(sum(l.contributions), 0)::int as contributions,
    coalesce(sum(l.appearances), 0)::int   as appearances,
    coalesce(sum(l.clean_sheets), 0)::int  as clean_sheets,
    coalesce(sum(l.penalty_saves), 0)::int as penalty_saves,
    coalesce(sum(l.total_points), 0)::numeric as points
  from public.player_month_lines l
  where l.organization_id = v_org and l.month_seq <= v_seq
  group by l.player_id;

  -- Milestones crossed this month. "first_ever" means nobody in the group had
  -- ever reached that number before — that is the line worth shouting about.
  with thresholds as (
    select * from (values
      ('goals', 25), ('goals', 50), ('goals', 100), ('goals', 150), ('goals', 200),
      ('assists', 25), ('assists', 50), ('assists', 100), ('assists', 150),
      ('appearances', 25), ('appearances', 50), ('appearances', 100), ('appearances', 150),
      ('contributions', 50), ('contributions', 100), ('contributions', 150), ('contributions', 200),
      ('clean_sheets', 10), ('clean_sheets', 25), ('clean_sheets', 50),
      ('penalty_saves', 5), ('penalty_saves', 10), ('penalty_saves', 25)
    ) t(metric, threshold)
  ),
  career as (
    select player_id, player_name, 'goals' as metric, 'goals' as noun,
           prior_goals as before_total, goals as after_total from tmp_rep_career
    union all
    select player_id, player_name, 'assists', 'assists', prior_assists, assists from tmp_rep_career
    union all
    select player_id, player_name, 'appearances', 'appearances', prior_appearances, appearances from tmp_rep_career
    union all
    select player_id, player_name, 'contributions', 'goal contributions', prior_contributions, contributions from tmp_rep_career
    union all
    select player_id, player_name, 'clean_sheets', 'clean sheets', prior_clean_sheets, clean_sheets from tmp_rep_career
    union all
    select player_id, player_name, 'penalty_saves', 'penalty saves', prior_penalty_saves, penalty_saves from tmp_rep_career
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'milestone',
           'metric', c.metric,
           'noun', c.noun,
           'threshold', t.threshold,
           'player_id', c.player_id,
           'player', c.player_name,
           'total', c.after_total,
           'first_ever', not exists (
             select 1 from career c2
             where c2.metric = c.metric and c2.before_total >= t.threshold
           )
         ) order by t.threshold desc, c.player_name), '[]'::jsonb)
  into v_milestones
  from career c
  join thresholds t on t.metric = c.metric
  where c.before_total < t.threshold and c.after_total >= t.threshold;

  -- 5. The double: top scorer and top assister in the same month -----------
  with tops as (
    select
      (select player_id from tmp_rep_values
        where month_seq = v_seq and metric = 'goals' and value > 0
        order by value desc, appearances asc limit 1) as scorer,
      (select player_id from tmp_rep_values
        where month_seq = v_seq and metric = 'assists' and value > 0
        order by value desc, appearances asc limit 1) as assister
  ),
  prior_doubles as (
    select count(*) as n from (
      select month_seq,
        (select player_id from tmp_rep_values v2
          where v2.month_seq = v.month_seq and v2.metric = 'goals' and v2.value > 0
          order by v2.value desc, v2.appearances asc limit 1) as scorer,
        (select player_id from tmp_rep_values v3
          where v3.month_seq = v.month_seq and v3.metric = 'assists' and v3.value > 0
          order by v3.value desc, v3.appearances asc limit 1) as assister
      from (select distinct month_seq from tmp_rep_values where month_seq < v_seq) v
    ) d where d.scorer is not null and d.scorer = d.assister
  )
  select case when t.scorer is null or t.scorer <> t.assister then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'kind', 'double',
      'player_id', t.scorer,
      'player', (select player_name from tmp_rep_now where player_id = t.scorer),
      'goals', (select goals from tmp_rep_now where player_id = t.scorer),
      'assists', (select assists from tmp_rep_now where player_id = t.scorer),
      'first_ever', (select n from prior_doubles) = 0
    )) end
  into v_doubles
  from tops t;

  -- 6. Reference tables the group likes to see -----------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', player_id, 'player', player_name, 'nominations', n
         ) order by n desc, player_name), '[]'::jsonb)
  into v_nominations
  from (
    select player_id, max(player_name) as player_name, count(*)::int as n
    from public.player_month_lines
    where organization_id = v_org and month_seq <= v_seq
      and period_status = 'closed' and rank is not null and rank <= 3
    group by player_id
    order by n desc, max(player_name)
    limit 10
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'month', pr.label, 'year', pr.year, 'month_number', pr.month,
           'player_id', a.player_id,
           'player', coalesce(nullif(btrim(pl.whatsapp_nickname), ''), pl.display_name),
           'value', a.value
         ) order by pr.year, pr.month), '[]'::jsonb)
  into v_potm
  from public.awards a
  join public.periods pr on pr.id = a.period_id
  join public.award_types at on at.id = a.award_type_id and at.code = 'player_of_month'
  join public.players pl on pl.id = a.player_id
  where a.organization_id = v_org and pr.year * 12 + pr.month <= v_seq;

  -- Top ten single months, per metric, all-time.
  select coalesce(jsonb_object_agg(metric, rows), '{}'::jsonb)
  into v_month_records
  from (
    select metric, jsonb_agg(jsonb_build_object(
             'player_id', player_id, 'player', player_name, 'value', value,
             'appearances', appearances, 'month', month_label
           ) order by value desc, appearances asc) as rows
    from (
      select *, row_number() over (partition by metric order by value desc, appearances asc) as rn
      from tmp_rep_values
      where value > 0
    ) r
    where rn <= 10
    group by metric
  ) y;

  -- Career table: everyone, plus a top ten per metric.
  select jsonb_build_object(
    'table', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', player_id, 'player', player_name,
        'goals', goals, 'assists', assists, 'contributions', contributions,
        'clean_sheets', clean_sheets, 'penalty_saves', penalty_saves,
        'appearances', appearances, 'points', points
      ) order by contributions desc, goals desc) from tmp_rep_career), '[]'::jsonb),
    'top', coalesce((
      select jsonb_object_agg(metric, rows) from (
        select metric, jsonb_agg(jsonb_build_object(
                 'player_id', player_id, 'player', player_name, 'value', value,
                 'appearances', appearances,
                 'per_game', case when appearances > 0
                                  then round(value / appearances, 2) else 0 end
               ) order by value desc, appearances asc) as rows
        from (
          select *, row_number() over (partition by metric order by value desc, appearances asc) as rn
          from (
            select player_id, player_name, appearances, 'goals' as metric, goals::numeric as value from tmp_rep_career
            union all
            select player_id, player_name, appearances, 'assists', assists from tmp_rep_career
            union all
            select player_id, player_name, appearances, 'contributions', contributions from tmp_rep_career
            union all
            select player_id, player_name, appearances, 'appearances', appearances from tmp_rep_career
            union all
            select player_id, player_name, appearances, 'clean_sheets', clean_sheets from tmp_rep_career
            union all
            select player_id, player_name, appearances, 'penalty_saves', penalty_saves from tmp_rep_career
          ) c where c.value > 0
        ) r
        where rn <= 10
        group by metric
      ) t
    ), '{}'::jsonb)
  )
  into v_alltime;

  -- 7. Plain-English headlines ---------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(h.line) order by h.grp, h.ord desc), '[]'::jsonb)
  into v_headlines
  from (
    -- Records
    select case
      when (r->>'first_ever')::boolean then
        format('%s set the first record for the most %s — %s in %s appearances.',
          r->>'player', r->>'metric_label', public.fmt_num((r->>'value')::numeric), r->>'appearances')
      else
        format('%s broke the record for the most %s, with %s in %s appearances — past %s, who had %s in %s appearances (%s).',
          r->>'player', r->>'metric_label', public.fmt_num((r->>'value')::numeric), r->>'appearances',
          r->'previous'->>'player', public.fmt_num((r->'previous'->>'value')::numeric),
          r->'previous'->>'appearances', r->'previous'->>'month')
      end as line,
      1 as grp, (r->>'value')::numeric as ord
    from jsonb_array_elements(v_records) r
    union all
    -- The double
    select case when (d->>'first_ever')::boolean then
        format('%s became the first player to finish a month as both top scorer and top assister (%s goals, %s assists).',
          d->>'player', d->>'goals', d->>'assists')
      else
        format('%s finished the month as both top scorer and top assister (%s goals, %s assists).',
          d->>'player', d->>'goals', d->>'assists')
      end, 2, 0
    from jsonb_array_elements(v_doubles) d
    union all
    -- Milestones
    select case when (m->>'first_ever')::boolean then
        format('%s became the first player to reach %s %s.', m->>'player', m->>'threshold', m->>'noun')
      else
        format('%s reached %s career %s.', m->>'player', m->>'threshold', m->>'noun')
      end, 3, (m->>'threshold')::numeric
    from jsonb_array_elements(v_milestones) m
  ) h;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'id', p_period, 'label', v_label, 'year', v_year, 'month', v_month,
      'status', v_status, 'starts_on', v_start, 'ends_on', v_end
    ),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'squad_size', v_squad,
    'attendance', coalesce(v_attendance, '{}'::jsonb),
    'perfect_attendance', v_perfect,
    'totals', v_totals,
    'awards', v_awards,
    'records', v_records,
    'doubles', v_doubles,
    'milestones', v_milestones,
    'nominations', v_nominations,
    'potm_history', v_potm,
    'month_records', v_month_records,
    'alltime', v_alltime,
    'headlines', v_headlines,
    'generated_at', now()
  );
end;
$fn$;
