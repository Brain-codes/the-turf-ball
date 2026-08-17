-- Appearances must be counted once per SESSION, not once per match.
--
-- Previously `apps` counted `distinct mp.match_id`. A session that goes to
-- full time and then starts a new match (same players, same day) created a
-- second `matches` row with its own `match_players` roster, so a player who
-- never left the pitch got credited with 2 appearances for one day. The
-- reported behaviour ("as long as the session started, that's one
-- appearance, no matter how many times we go to full time and restart") is
-- session-scoped, so count distinct sessions instead. Everything else in
-- this function is an exact copy of the original from
-- 20260816121000_engine.sql — only the `apps` CTE's group-by column changed.
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
  -- Appearances come from match rosters, but count once per SESSION — not
  -- once per match — so restarting a match within the same session (full
  -- time, then a fresh match) doesn't double an appearance.
  apps as (
    select mp.player_id, count(distinct mt.session_id)::int as n
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
