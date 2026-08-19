-- Global leaderboard: cross-org player/team tables for the public landing page.
--
-- organizations.is_public is deliberately a separate flag from
-- public_pages.is_published — a team can be listed in the global directory
-- independently of whether their own shareable page is turned on.
alter table public.organizations
  add column is_public boolean not null default true;

create index organizations_public_idx
  on public.organizations(is_public)
  where deleted_at is null and status = 'active';

-- All-time per-player aggregate across every period, one row per (org, player).
-- player_period_stats is a per-month cache; there is no existing all-time
-- rollup, so this view sums across periods on read. Data volume here is
-- grassroots-scale, so a plain view (not materialized) stays cheap and fresh.
create view public.player_alltime_stats as
select
  s.organization_id,
  s.player_id,
  sum(s.appearances)   as appearances,
  sum(s.goals)         as goals,
  sum(s.own_goals)     as own_goals,
  sum(s.assists)       as assists,
  sum(s.clean_sheets)  as clean_sheets,
  sum(s.yellow_cards)  as yellow_cards,
  sum(s.red_cards)     as red_cards,
  sum(s.saves)         as saves,
  count(distinct s.period_id) as periods_played,
  max(s.computed_at)   as last_computed_at
from public.player_period_stats s
group by s.organization_id, s.player_id;

-- All-time per-team aggregate, same source.
create view public.org_alltime_stats as
select
  s.organization_id,
  sum(s.appearances)  as appearances,
  sum(s.goals)        as goals,
  sum(s.own_goals)    as own_goals,
  sum(s.assists)      as assists,
  sum(s.clean_sheets) as clean_sheets,
  sum(s.yellow_cards) as yellow_cards,
  sum(s.red_cards)    as red_cards,
  sum(s.saves)        as saves,
  count(distinct s.player_id) as player_count
from public.player_period_stats s
group by s.organization_id;

-- Supports the group by / join above.
create index player_period_stats_org_player_idx
  on public.player_period_stats(organization_id, player_id);
