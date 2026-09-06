-- ============================================================================
-- Every session gets its own stats, and knows where it sits against every
-- session ever played.
--
-- The month already had this. A single match day did not: you could see the
-- scoreline and who turned up, but not who scored what, and certainly not
-- "that is the most goals anyone has managed in one evening".
--
-- Same shape as the monthly report deliberately — one player-line table, one
-- unpivot, records fall out of comparing this session's best against every
-- session before it. Cancelled sessions are excluded everywhere: a session
-- that never happened cannot hold a record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- One row per player per session. The session equivalent of
-- player_month_lines.
--
-- A player is "in" a session if they were named in a match on it. Attendance
-- alone is turning up, not playing, and it already earns its punctuality
-- points through the month's totals.
-- ---------------------------------------------------------------------------
create or replace view public.player_session_lines
with (security_invoker = true) as
with squad as (
  select
    s.organization_id,
    s.id           as session_id,
    s.session_date,
    s.period_id,
    s.status       as session_status,
    mp.player_id,
    count(distinct mp.match_id)::int as matches_played,
    bool_or(mp.is_goalkeeper)        as kept_goal
  from public.sessions s
  join public.matches mt
    on mt.session_id = s.id and mt.status in ('completed', 'live')
  join public.match_players mp on mp.match_id = mt.id
  where s.status <> 'cancelled'
  group by s.organization_id, s.id, s.session_date, s.period_id, s.status, mp.player_id
),
ev as (
  select
    mt.session_id,
    me.player_id,
    count(*) filter (where me.event_type = 'goal')         ::int as goals,
    count(*) filter (where me.event_type = 'assist')       ::int as assists,
    count(*) filter (where me.event_type = 'own_goal')     ::int as own_goals,
    count(*) filter (where me.event_type = 'clean_sheet')  ::int as clean_sheets,
    count(*) filter (where me.event_type = 'yellow_card')  ::int as yellow_cards,
    count(*) filter (where me.event_type = 'red_card')     ::int as red_cards,
    count(*) filter (where me.event_type = 'save')         ::int as saves,
    count(*) filter (where me.event_type = 'penalty_save') ::int as penalty_saves
  from public.match_events me
  join public.matches mt on mt.id = me.match_id
  where me.voided_at is null
  group by mt.session_id, me.player_id
)
select
  q.organization_id,
  q.session_id,
  q.session_date,
  q.period_id,
  q.session_status,
  q.player_id,
  coalesce(nullif(btrim(pl.whatsapp_nickname), ''), pl.display_name) as player_name,
  pl.display_name,
  pl.photo_url,
  q.matches_played,
  q.kept_goal,
  coalesce(e.goals, 0)         as goals,
  coalesce(e.assists, 0)       as assists,
  coalesce(e.own_goals, 0)     as own_goals,
  coalesce(e.clean_sheets, 0)  as clean_sheets,
  coalesce(e.yellow_cards, 0)  as yellow_cards,
  coalesce(e.red_cards, 0)     as red_cards,
  coalesce(e.saves, 0)         as saves,
  coalesce(e.penalty_saves, 0) as penalty_saves,
  coalesce(e.goals, 0) + coalesce(e.assists, 0) as contributions,
  a.punctuality_band,
  a.arrived_at
from squad q
join public.players pl on pl.id = q.player_id
left join ev e
  on e.session_id = q.session_id and e.player_id = q.player_id
left join public.session_attendance a
  on a.session_id = q.session_id and a.player_id = q.player_id and a.status = 'present';

-- ---------------------------------------------------------------------------
-- The session, in full.
-- ---------------------------------------------------------------------------
create or replace function public.build_session_report(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_date     date;
  v_title    text;
  v_venue    text;
  v_status   session_status;
  v_period   uuid;
  v_kickoff  timestamptz;
  v_started  timestamptz;
  v_ended    timestamptz;

  v_summary    jsonb;
  v_lines      jsonb;
  v_matches    jsonb;
  v_attendance jsonb;
  v_records    jsonb;
  v_hattricks  jsonb;
  v_best       jsonb;
  v_alltime    jsonb;
  v_headlines  jsonb;
  v_nth        int;
begin
  select organization_id, session_date, title, venue, status, period_id,
         kickoff_at, actual_kickoff_at, ended_at
    into v_org, v_date, v_title, v_venue, v_status, v_period,
         v_kickoff, v_started, v_ended
  from public.sessions where id = p_session;

  if v_org is null then
    raise exception 'Session not found';
  end if;

  -- 1. This session's player lines ------------------------------------------
  drop table if exists tmp_sess_now;
  create temp table tmp_sess_now on commit drop as
  select * from public.player_session_lines where session_id = p_session;

  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', player_id,
           'player', player_name,
           'display_name', display_name,
           'photo_url', photo_url,
           'goals', goals,
           'assists', assists,
           'contributions', contributions,
           'own_goals', own_goals,
           'clean_sheets', clean_sheets,
           'yellow_cards', yellow_cards,
           'red_cards', red_cards,
           'saves', saves,
           'penalty_saves', penalty_saves,
           'matches_played', matches_played,
           'kept_goal', kept_goal,
           'punctuality_band', punctuality_band
         ) order by contributions desc, goals desc, player_name), '[]'::jsonb)
  into v_lines
  from tmp_sess_now;

  select jsonb_build_object(
    'players', count(*),
    'goals', coalesce(sum(goals), 0),
    'assists', coalesce(sum(assists), 0),
    'own_goals', coalesce(sum(own_goals), 0),
    'clean_sheets', coalesce(sum(clean_sheets), 0),
    'cards', coalesce(sum(yellow_cards + red_cards), 0),
    'penalty_saves', coalesce(sum(penalty_saves), 0)
  )
  into v_summary
  from tmp_sess_now;

  select coalesce(jsonb_agg(jsonb_build_object(
           'match_id', id, 'sequence', sequence, 'status', status,
           'goals', side_a_score, 'own_goals', side_b_score,
           'started_at', started_at, 'ended_at', ended_at
         ) order by sequence), '[]'::jsonb)
  into v_matches
  from public.matches where session_id = p_session and status <> 'abandoned';

  select jsonb_build_object(
    'present', count(*) filter (where status = 'present'),
    'absent', count(*) filter (where status = 'absent'),
    'excused', count(*) filter (where status = 'excused'),
    'early', count(*) filter (where punctuality_band = 'early'),
    'on_time', count(*) filter (where punctuality_band = 'on_time'),
    'late', count(*) filter (where punctuality_band = 'late'),
    'very_late', count(*) filter (where punctuality_band = 'very_late')
  )
  into v_attendance
  from public.session_attendance where session_id = p_session;

  -- Which session number is this, in the club's whole history?
  select count(*)::int into v_nth
  from public.sessions
  where organization_id = v_org
    and status <> 'cancelled'
    and (session_date < v_date or (session_date = v_date and id <= p_session));

  -- 2. Every player-session, unpivoted, up to and including this one --------
  drop table if exists tmp_sess_values;
  create temp table tmp_sess_values on commit drop as
  select
    l.player_id, l.player_name, l.session_id, l.session_date, l.matches_played,
    v.metric, v.metric_label, v.value,
    (l.session_id = p_session) as is_this_one
  from public.player_session_lines l
  cross join lateral (values
    ('goals',         'goals in a single session',              l.goals::numeric),
    ('assists',       'assists in a single session',            l.assists::numeric),
    ('contributions', 'goal contributions in a single session', l.contributions::numeric),
    ('clean_sheets',  'clean sheets in a single session',       l.clean_sheets::numeric),
    ('penalty_saves', 'penalty saves in a single session',      l.penalty_saves::numeric)
  ) as v(metric, metric_label, value)
  -- Everything up to and including tonight. Another session on the same day
  -- counts as prior, which is the right call for a club that occasionally
  -- plays twice in a day.
  where l.organization_id = v_org
    and l.session_date <= v_date;

  -- Records broken tonight: this session's best beats every session before it.
  with now_best as (
    select distinct on (metric)
      metric, metric_label, player_id, player_name, value, matches_played
    from tmp_sess_values
    where is_this_one and value > 0
    order by metric, value desc, matches_played asc
  ),
  prior_best as (
    select distinct on (metric)
      metric, player_id, player_name, value, matches_played, session_date
    from tmp_sess_values
    where not is_this_one and value > 0
    order by metric, value desc, matches_played asc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'session_record',
           'metric', n.metric,
           'metric_label', n.metric_label,
           'player_id', n.player_id,
           'player', n.player_name,
           'value', n.value,
           'first_ever', p.metric is null,
           'previous', case when p.metric is null then null else jsonb_build_object(
             'player', p.player_name, 'value', p.value, 'date', p.session_date
           ) end
         ) order by n.metric), '[]'::jsonb)
  into v_records
  from now_best n
  left join prior_best p on p.metric = n.metric
  where p.metric is null or n.value > p.value;

  -- 3. Hat-tricks. The one number everyone in a five-a-side actually counts.
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_id', n.player_id,
           'player', n.player_name,
           'goals', n.goals,
           'first_ever', not exists (
             select 1 from public.player_session_lines o
             where o.organization_id = v_org
               and o.player_id = n.player_id
               and o.session_id <> p_session
               and o.session_date <= v_date
               and o.goals >= 3
           )
         ) order by n.goals desc, n.player_name), '[]'::jsonb)
  into v_hattricks
  from tmp_sess_now n
  where n.goals >= 3;

  -- 4. Best on the night, and the all-time single-session top tens ----------
  select case when count(*) = 0 then null else
    (select jsonb_build_object(
       'player_id', player_id, 'player', player_name,
       'goals', goals, 'assists', assists, 'contributions', contributions
     )
     from tmp_sess_now
     order by contributions desc, goals desc, assists desc
     limit 1)
  end
  into v_best
  from tmp_sess_now;

  select coalesce(jsonb_object_agg(metric, rows), '{}'::jsonb)
  into v_alltime
  from (
    select metric, jsonb_agg(jsonb_build_object(
             'player_id', player_id, 'player', player_name,
             'value', value, 'date', session_date,
             'is_this_session', is_this_one
           ) order by value desc, session_date desc) as rows
    from (
      select *, row_number() over (partition by metric order by value desc, session_date desc) as rn
      from tmp_sess_values
      where value > 0
    ) r
    where rn <= 10
    group by metric
  ) y;

  -- 5. Headlines -------------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(h.line) order by h.grp, h.ord desc), '[]'::jsonb)
  into v_headlines
  from (
    select case
      when (r->>'first_ever')::boolean then
        format('%s set the first record for the most %s — %s.',
          r->>'player', r->>'metric_label', public.fmt_num((r->>'value')::numeric))
      else
        format('%s broke the record for the most %s with %s, past %s who had %s on %s.',
          r->>'player', r->>'metric_label', public.fmt_num((r->>'value')::numeric),
          r->'previous'->>'player', public.fmt_num((r->'previous'->>'value')::numeric),
          to_char((r->'previous'->>'date')::date, 'FMDD Mon YYYY'))
      end as line,
      1 as grp, (r->>'value')::numeric as ord
    from jsonb_array_elements(v_records) r
    union all
    select case when (h->>'first_ever')::boolean then
        format('%s scored their first hat-trick — %s goals.', h->>'player', h->>'goals')
      else
        format('%s scored %s.', h->>'player',
          case when (h->>'goals')::int = 3 then 'a hat-trick'
               else (h->>'goals') || ' goals' end)
      end, 2, (h->>'goals')::numeric
    from jsonb_array_elements(v_hattricks) h
  ) h;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', p_session, 'date', v_date, 'title', v_title, 'venue', v_venue,
      'status', v_status, 'period_id', v_period,
      'kickoff_at', v_kickoff, 'started_at', v_started, 'ended_at', v_ended,
      'number', v_nth
    ),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'attendance', coalesce(v_attendance, '{}'::jsonb),
    'matches', v_matches,
    'players', v_lines,
    'best_on_the_night', v_best,
    'records', v_records,
    'hat_tricks', v_hattricks,
    'alltime', v_alltime,
    'headlines', v_headlines,
    'generated_at', now()
  );
end;
$fn$;
