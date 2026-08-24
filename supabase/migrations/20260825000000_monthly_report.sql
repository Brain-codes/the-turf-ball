-- ---------------------------------------------------------------------------
-- Automatic month close + the full monthly breakdown.
--
-- Two things happen here:
--
--   1. Months close themselves. The organizer no longer has to remember to
--      press "Close July" — a scheduled job closes any open month once its
--      last day has passed (plus a short grace window for late data entry).
--      An unfinished session still blocks the close, exactly as it does when
--      a human presses the button; the reason is recorded on the period and
--      the job tries again on the next run.
--
--   2. Every closed month gets a permanent, structured report: attendance per
--      session, the full stats table, awards, records broken, career
--      milestones crossed, all-time top tens, and a set of ready-to-paste
--      plain-English headlines ("X broke the record for the most goals in a
--      month...").
--
-- The report is stored as jsonb at close time so it can never drift: names,
-- numbers and records are frozen the moment the month ends, like award
-- breakdowns already are.
-- ---------------------------------------------------------------------------

-- --- auto-close configuration ----------------------------------------------

alter table public.org_settings
  add column if not exists auto_close_months    boolean not null default true,
  -- Days after the last day of the month to wait before closing. 1 = close on
  -- the 2nd, which leaves a day to key in anything recorded on paper.
  add column if not exists auto_close_grace_days integer not null default 1
    check (auto_close_grace_days between 0 and 14);

alter table public.periods
  add column if not exists closed_automatically boolean not null default false,
  add column if not exists auto_close_blocked_at timestamptz,
  add column if not exists auto_close_blocked_reason text;

-- --- the stored report ------------------------------------------------------

create table if not exists public.period_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id       uuid not null references public.periods(id) on delete cascade,
  data            jsonb not null,
  generated_at    timestamptz not null default now(),
  unique (period_id)
);

create index if not exists period_reports_org_idx
  on public.period_reports(organization_id, generated_at desc);

alter table public.period_reports enable row level security;
alter table public.period_reports force row level security;

-- --- helpers ----------------------------------------------------------------

-- "54.00" reads like a machine wrote it. Headlines want "54", and "2.5" when
-- there really is a half point.
create or replace function public.fmt_num(v numeric)
returns text
language sql
immutable
as $fn$
  select case
    when v is null then ''
    when v = trunc(v) then trunc(v)::bigint::text
    else rtrim(rtrim(to_char(v, 'FM999999990.99'), '0'), '.')
  end;
$fn$;

-- One row per player per month, with the player's name already resolved and
-- the month flattened to a sortable integer. Every record query below reads
-- from here.
create or replace view public.player_month_lines
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

-- ---------------------------------------------------------------------------
-- build_period_report — the whole month, as one jsonb document.
--
-- Safe to call on an open month too: it simply reports the month so far, which
-- is what the "live" preview on the Awards screen shows.
-- ---------------------------------------------------------------------------
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
    coalesce(sum(l.goals), 0)::int         as goals,
    coalesce(sum(l.assists), 0)::int       as assists,
    coalesce(sum(l.contributions), 0)::int as contributions,
    coalesce(sum(l.appearances), 0)::int   as appearances,
    coalesce(sum(l.clean_sheets), 0)::int  as clean_sheets,
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
      ('clean_sheets', 10), ('clean_sheets', 25), ('clean_sheets', 50)
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
        'clean_sheets', clean_sheets, 'appearances', appearances, 'points', points
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

-- ---------------------------------------------------------------------------
-- Freeze the report onto the period. Called at close; can also be re-run by an
-- owner if a month is reopened, corrected and closed again.
-- ---------------------------------------------------------------------------
create or replace function public.store_period_report(p_period uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_data jsonb;
begin
  select organization_id into v_org from public.periods where id = p_period;
  if v_org is null then raise exception 'Month not found'; end if;

  v_data := public.build_period_report(p_period);

  insert into public.period_reports (organization_id, period_id, data)
  values (v_org, p_period, v_data)
  on conflict (period_id) do update
    set data = excluded.data, generated_at = now();

  return v_data;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- close_period, republished with one addition: step 5 writes the month's
-- report. Everything else is unchanged from 20260816121000_engine.sql.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Reopening a month throws its report away: the numbers behind it are about
-- to change, and a stale report is worse than none.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- The scheduler. Closes any month whose last day has passed, in the
-- organization's own timezone, once the grace window is over.
--
-- An unfinished session blocks the close exactly as it does for a human — the
-- reason is written onto the period so the Awards screen can explain the delay,
-- and the next run tries again. Catching up several months at once is allowed
-- but bounded, so a broken month can never spin the job.
-- ---------------------------------------------------------------------------
create or replace function public.auto_close_due_periods()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  org       record;
  v_period  record;
  v_today   date;
  v_grace   int;
  v_closed  int := 0;
  v_guard   int;
begin
  for org in
    select o.id, o.timezone,
           coalesce(cfg.auto_close_months, true) as enabled,
           coalesce(cfg.auto_close_grace_days, 1) as grace_days
    from public.organizations o
    left join public.org_settings cfg on cfg.organization_id = o.id
    where o.status = 'active' and o.deleted_at is null
  loop
    continue when not org.enabled;

    v_today := (now() at time zone coalesce(nullif(org.timezone, ''), 'UTC'))::date;
    v_grace := org.grace_days;
    v_guard := 0;

    loop
      v_guard := v_guard + 1;
      exit when v_guard > 24;

      select id, label, ends_on into v_period
      from public.periods
      where organization_id = org.id and status = 'open'
      limit 1;

      exit when v_period.id is null;
      exit when v_today <= v_period.ends_on + v_grace;

      if exists (
        select 1 from public.sessions s
        where s.period_id = v_period.id and s.status in ('live', 'paused')
      ) then
        update public.periods
        set auto_close_blocked_at = now(),
            auto_close_blocked_reason = 'A session is still open — finish it and the month will close itself.'
        where id = v_period.id;
        exit;
      end if;

      begin
        perform public.close_period(v_period.id, null);
        update public.periods set closed_automatically = true where id = v_period.id;
        v_closed := v_closed + 1;
      exception when others then
        update public.periods
        set auto_close_blocked_at = now(), auto_close_blocked_reason = sqlerrm
        where id = v_period.id;
        exit;
      end;
    end loop;
  end loop;

  return v_closed;
end;
$fn$;

-- Hourly, not daily: organizations span timezones and a month should close
-- soon after midnight local, not whenever a UTC daily job happens to land.
select cron.schedule(
  'auto-close-months',
  '25 * * * *',
  $cron$select public.auto_close_due_periods();$cron$
);
