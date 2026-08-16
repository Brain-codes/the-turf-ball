-- Real football position labels instead of the four broad buckets
-- (GK/DEF/MID/FWD). MatchDay.tsx only depends on 'GK' specifically to
-- auto-pick goalkeepers, so that value is kept as-is; everything else is
-- remapped to a sensible specific position on the way in.
create type player_position_new as enum (
  'GK',
  'RB', 'CB', 'LB',
  'CDM', 'CM', 'CAM', 'LM', 'RM',
  'LW', 'RW', 'ST', 'CF'
);

alter table public.players
  alter column position type player_position_new
  using (
    case position::text
      when 'GK'  then 'GK'
      when 'DEF' then 'CB'
      when 'MID' then 'CM'
      when 'FWD' then 'ST'
      else null
    end
  )::player_position_new;

drop type player_position;
alter type player_position_new rename to player_position;
