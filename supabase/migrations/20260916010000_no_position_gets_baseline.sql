-- ============================================================================
-- Players with no position get the flat (baseline) goal and assist points.
--
-- 20260916000000 lumped them in with forwards, which only matched the
-- baseline until someone edited the forward values. They now get their own
-- line, 'NONE', which has no position_points row, so the engine falls back to
-- the group's ordinary goal/assist rule.
-- ============================================================================

create or replace function public.position_line(p public.player_position)
returns text
language sql
immutable
as $$
  select case
    when p is null then 'NONE'
    when p = 'GK' then 'GK'
    when p in ('RB', 'CB', 'LB') then 'DEF'
    when p in ('CDM', 'CM', 'CAM', 'LM', 'RM') then 'MID'
    else 'FWD'
  end;
$$;

-- Same as 20260916000000 except the baseline fallback in positional_points.
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
        -- No position ('NONE') has no row here, so it falls back to the flat rule.
        + case when exists (select 1 from rules where event_type = 'goal')
            then c.goals * coalesce((select points from pos_rules pr
                                     where pr.line = c.position_line and pr.event_type = 'goal'),
                                    (select points from rules where event_type = 'goal'))
            else 0 end
        + case when exists (select 1 from rules where event_type = 'assist')
            then c.assists * coalesce((select points from pos_rules pr
                                       where pr.line = c.position_line and pr.event_type = 'assist'),
                                      (select points from rules where event_type = 'assist'))
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

select public.recompute_period_stats(p.id)
from public.periods p
where p.status <> 'closed';
