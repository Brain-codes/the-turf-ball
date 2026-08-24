-- ============================================================================
-- Competitions — standalone tournaments alongside sessions.
--
-- A session is one recurring turn-up day. A competition is a tournament: an
-- organizer drafts balanced teams from the squad, the system generates a
-- round-robin fixture list, and a table computes itself. It is deliberately
-- NOT a session with extra features — a different shape entirely, additive
-- only. Nothing about sessions, session_slots, or the existing session
-- lifecycle is touched by this migration except two nullable columns that
-- let a match originate from a competition fixture instead of a session.
--
-- Structured as competitions -> rounds -> fixtures so that a future knockout
-- or group-stage format is a new `kind` value on competition_rounds, not a
-- rewrite. Only 'round_robin' (a league) is built today.
-- ============================================================================

create table public.competitions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  period_id              uuid not null references public.periods(id) on delete restrict,
  name                   text not null,
  status                 text not null default 'draft'
                           check (status in ('draft','drafting_teams','scheduled','live','completed','cancelled')),
  starts_on              date not null,
  ends_on                date not null,
  -- Only used on a single-day competition (starts_on = ends_on) to derive
  -- per-match duration from the available window, same arithmetic the
  -- WhatsApp organizer does by hand: (window - buffer) / fixture count.
  day_ends_at            time,
  format                 text not null default 'league' check (format in ('league')),
  double_round_robin     boolean not null default false,
  team_count             integer not null check (team_count between 2 and 16),
  squad_size             integer not null check (squad_size >= 2),
  pitch_size             integer not null check (pitch_size >= 1),
  match_duration_minutes integer check (match_duration_minutes between 1 and 180),
  -- The stats toggle. Default on: competition goals count towards a
  -- player's normal record unless someone turns it off, at creation or
  -- retroactively. Read at aggregation time (recompute_period_stats),
  -- never at write time — match_events are always written in full.
  count_toward_stats     boolean not null default true,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Cancel = soft-void, same pattern as match_events. Never hard-deleted.
  voided_at              timestamptz,
  voided_by              uuid references public.profiles(id) on delete set null,

  check (ends_on >= starts_on),
  check (pitch_size <= squad_size)
);

create index competitions_org_dates_idx
  on public.competitions(organization_id, starts_on, ends_on) where voided_at is null;
create index competitions_period_idx on public.competitions(period_id);

create trigger competitions_touch before update on public.competitions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Intent to play: a player has joined the competition, before teams exist.
-- Distinct from competition_team_players (below), which is the post-draft
-- assignment. This is what the draft algorithm draws from, and what the
-- join link / quick-add both write to.
-- ---------------------------------------------------------------------------
create table public.competition_players (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  competition_id    uuid not null references public.competitions(id) on delete cascade,
  player_id         uuid not null references public.players(id) on delete cascade,
  joined_at         timestamptz not null default now(),
  removed_at        timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,

  unique (competition_id, player_id)
);
create index competition_players_comp_idx on public.competition_players(competition_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- A drafted team, for the competition's lifetime.
-- ---------------------------------------------------------------------------
create table public.competition_teams (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  competition_id    uuid not null references public.competitions(id) on delete cascade,
  name              text,
  short_name        text,
  color             text,
  -- Cosmetic only today — a badge next to the name, no permissions attached.
  -- The field exists so a captain can mean something later without a schema
  -- change.
  captain_player_id uuid references public.players(id) on delete set null,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index competition_teams_comp_idx on public.competition_teams(competition_id, sort_order);

create trigger competition_teams_touch before update on public.competition_teams
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Roster membership — the join point the draft (and every manual edit
-- after it) writes to. joined_at drives "stats count from here" for anyone
-- who joins after the draft already happened; removed_at is a soft-remove,
-- never a delete, so history of who played for whom survives.
-- ---------------------------------------------------------------------------
create table public.competition_team_players (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  competition_id       uuid not null references public.competitions(id) on delete cascade,
  competition_team_id  uuid not null references public.competition_teams(id) on delete cascade,
  player_id            uuid not null references public.players(id) on delete cascade,
  joined_at            timestamptz not null default now(),
  removed_at           timestamptz,
  created_by           uuid references public.profiles(id) on delete set null
);

-- One ACTIVE team per player per competition. A partial unique index (rather
-- than a plain unique constraint) so a player can be removed from one team
-- and drafted onto another without the old, soft-removed row blocking it.
create unique index competition_team_players_active_uniq
  on public.competition_team_players(competition_id, player_id) where removed_at is null;
create index competition_team_players_team_idx
  on public.competition_team_players(competition_team_id) where removed_at is null;
create index competition_team_players_player_idx on public.competition_team_players(player_id);

-- ---------------------------------------------------------------------------
-- Rounds — the abstraction that lets knockout/group-stage formats slot in
-- later without touching this table's shape. A league today is exactly one
-- round with kind = 'round_robin'.
-- ---------------------------------------------------------------------------
create table public.competition_rounds (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  competition_id    uuid not null references public.competitions(id) on delete cascade,
  kind              text not null default 'round_robin' check (kind in ('round_robin')),
  sequence          integer not null default 1,
  created_at        timestamptz not null default now(),

  unique (competition_id, sequence)
);

-- ---------------------------------------------------------------------------
-- One fixture = one intended match within a round. match_id is set once
-- MatchDay actually starts it — a fixture can exist, be rescheduled, be
-- swapped, all before any match row exists.
-- ---------------------------------------------------------------------------
create table public.competition_fixtures (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  competition_id        uuid not null references public.competitions(id) on delete cascade,
  competition_round_id  uuid not null references public.competition_rounds(id) on delete cascade,
  sequence              integer not null,
  home_team_id          uuid not null references public.competition_teams(id) on delete cascade,
  away_team_id          uuid not null references public.competition_teams(id) on delete cascade,
  scheduled_at          timestamptz,
  duration_minutes      integer,
  match_id              uuid references public.matches(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (home_team_id <> away_team_id)
);
create index competition_fixtures_round_idx on public.competition_fixtures(competition_round_id, sequence);
create index competition_fixtures_comp_idx on public.competition_fixtures(competition_id, scheduled_at);
create index competition_fixtures_match_idx on public.competition_fixtures(match_id);

create trigger competition_fixtures_touch before update on public.competition_fixtures
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Attendance per fixture — deliberately mirrors session_attendance in shape.
-- Punctuality bands are NOT computed here: that mechanic is tuned around a
-- single session kickoff time and doesn't map cleanly onto a tournament
-- fixture list. Out of scope for this iteration; presence-only.
-- ---------------------------------------------------------------------------
create table public.competition_fixture_attendance (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  competition_fixture_id   uuid not null references public.competition_fixtures(id) on delete cascade,
  player_id                uuid not null references public.players(id) on delete cascade,
  status                   attendance_status not null default 'present',
  created_at               timestamptz not null default now(),

  unique (competition_fixture_id, player_id)
);
create index competition_fixture_attendance_fixture_idx
  on public.competition_fixture_attendance(competition_fixture_id);

-- ---------------------------------------------------------------------------
-- Touchpoints into existing tables — additive and nullable. A match is
-- EITHER session-born OR competition-born, never both; session-born rows
-- (every row that exists before this migration) are untouched.
-- ---------------------------------------------------------------------------
alter table public.matches
  alter column session_id drop not null,
  add column competition_fixture_id uuid references public.competition_fixtures(id) on delete set null,
  add constraint matches_session_or_competition
    check (session_id is not null or competition_fixture_id is not null);

create index matches_competition_fixture_idx on public.matches(competition_fixture_id);

-- Denormalized for the same reason session_id/period_id already are on this
-- table: leaderboard aggregation across thousands of events stays a single
-- indexed scan instead of a join through matches -> fixtures -> competitions.
-- session_id on match_events was NOT NULL — a competition-born event has no
-- session to denormalize. period_id stays required; every competition match
-- still resolves one (via competitions.period_id), so the existing stats
-- machinery that keys off match_events.period_id needs no further change.
alter table public.match_events
  alter column session_id drop not null,
  add column competition_id uuid references public.competitions(id) on delete set null;

create index match_events_competition_idx
  on public.match_events(organization_id, competition_id) where voided_at is null;

-- ---------------------------------------------------------------------------
-- Row Level Security — same deny-all backstop as every other table.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'competitions','competition_players','competition_teams',
    'competition_team_players','competition_rounds','competition_fixtures',
    'competition_fixture_attendance'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Appearances in recompute_period_stats currently only look at match_players
-- joined through matches -> sessions, so a competition-born match (no
-- session_id) would never count as an appearance. Patch the `apps` CTE to
-- also resolve a period through the competition path, gated by the
-- per-competition stats toggle. Everything else in the function (goals,
-- assists, cards, etc, via match_events.period_id) already works for
-- competition matches unmodified — those never depended on sessions — except
-- that they too need the toggle applied, since a voided competition_id
-- shouldn't leak into a rollup either.
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
      count(*) filter (where event_type = 'goal')        ::int as goals,
      count(*) filter (where event_type = 'own_goal')    ::int as own_goals,
      count(*) filter (where event_type = 'assist')      ::int as assists,
      count(*) filter (where event_type = 'clean_sheet') ::int as clean_sheets,
      count(*) filter (where event_type = 'yellow_card') ::int as yellows,
      count(*) filter (where event_type = 'red_card')    ::int as reds,
      count(*) filter (where event_type = 'save')        ::int as saves
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
-- Per-player, per-period breakdown of goals/assists/etc split by origin
-- (session vs competition). Powers the "?" breakdown shown next to a
-- player's stats wherever they appear. Read-only, computed on demand — no
-- new cache table, competition-scale data is small.
-- ---------------------------------------------------------------------------
create or replace function public.player_stats_breakdown(p_player uuid, p_period uuid)
returns table (
  source text,
  appearances bigint,
  goals bigint,
  own_goals bigint,
  assists bigint,
  clean_sheets bigint,
  yellow_cards bigint,
  red_cards bigint,
  saves bigint
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
    count(*) filter (where base.event_type = 'goal' and base.source = src.source)        as goals,
    count(*) filter (where base.event_type = 'own_goal' and base.source = src.source)    as own_goals,
    count(*) filter (where base.event_type = 'assist' and base.source = src.source)      as assists,
    count(*) filter (where base.event_type = 'clean_sheet' and base.source = src.source) as clean_sheets,
    count(*) filter (where base.event_type = 'yellow_card' and base.source = src.source) as yellow_cards,
    count(*) filter (where base.event_type = 'red_card' and base.source = src.source)    as red_cards,
    count(*) filter (where base.event_type = 'save' and base.source = src.source)        as saves
  from (values ('session'), ('competition')) as src(source)
  left join apps on apps.source = src.source
  left join base on base.source = src.source
  group by src.source, apps.n;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler patch: a session must not be flagged inactive if the org has a
-- live competition running that day. This is the ONLY change to the session
-- scheduler; session creation/materialization itself is untouched.
-- ---------------------------------------------------------------------------
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
  -- 1. Materialise. Unchanged from 20260816161000_fix_session_scheduler.sql.
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

  -- 2. Go live at kick-off. Unchanged.
  update public.sessions s
  set status = 'live'
  from public.organizations o
  where s.organization_id = o.id
    and o.deleted_at is null
    and s.status = 'scheduled'
    and s.kickoff_at <= now();

  -- 3. Flag empties past their end time — UNLESS an active, non-voided
  -- competition covers that day. That is the one added predicate; everything
  -- else in this step is identical to 20260816161000_fix_session_scheduler.sql.
  -- A day deliberately given to a tournament is not a dead session.
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
    )
    and not exists (
      select 1 from public.competitions c
      where c.organization_id = s.organization_id
        and c.voided_at is null
        and s.session_date between c.starts_on and c.ends_on
    );
end;
$$;
