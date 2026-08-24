-- Adds the option to hard-delete the duplicate after a merge instead of
-- archiving it. Archiving (the existing default) is the safe choice — it
-- keeps anything left unmerged recoverable. Deleting is for when the two
-- rows really are the same person and there should only ever be one: any
-- category the organizer chose not to move over is permanently lost with
-- the deleted row (cascades through match_events, match_players,
-- session_attendance, awards, competition_* — same "on delete cascade" the
-- schema already uses everywhere a player can be removed).

drop function if exists public.merge_players(uuid, uuid, uuid, text[]);

create or replace function public.merge_players(
  p_org uuid,
  p_keep uuid,
  p_duplicate uuid,
  p_categories text[],
  p_delete boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_periods uuid[];
  v_matches uuid[];
  v_period  uuid;
  v_match   uuid;
begin
  if p_keep = p_duplicate then
    raise exception 'Cannot merge a player into themselves';
  end if;

  perform 1 from public.players where id = p_keep and organization_id = p_org;
  if not found then raise exception 'Keep player not found'; end if;

  perform 1 from public.players where id = p_duplicate and organization_id = p_org and status <> 'merged';
  if not found then raise exception 'Duplicate player not found, or already merged'; end if;

  if p_categories is not null and array_length(p_categories, 1) > 0 then
    update public.match_events
    set player_id = p_keep, edited_at = now()
    where organization_id = p_org
      and player_id = p_duplicate
      and event_type::text = any(p_categories)
      and voided_at is null;
  end if;

  if p_categories is not null and 'attendance' = any(p_categories) then
    update public.match_players mp
    set player_id = p_keep
    where mp.player_id = p_duplicate
      and mp.organization_id = p_org
      and not exists (
        select 1 from public.match_players k
        where k.match_id = mp.match_id and k.player_id = p_keep
      );
    delete from public.match_players where player_id = p_duplicate and organization_id = p_org;

    update public.session_attendance sa
    set player_id = p_keep
    where sa.player_id = p_duplicate
      and sa.organization_id = p_org
      and not exists (
        select 1 from public.session_attendance k
        where k.session_id = sa.session_id and k.player_id = p_keep
      );
    delete from public.session_attendance where player_id = p_duplicate and organization_id = p_org;
  end if;

  update public.match_events
  set related_player_id = p_keep
  where organization_id = p_org and related_player_id = p_duplicate;

  select array_agg(distinct s.period_id) into v_periods
  from public.sessions s
  join public.matches m on m.session_id = s.id
  where m.id in (
    select match_id from public.match_events
    where organization_id = p_org and player_id in (p_keep, p_duplicate)
    union
    select match_id from public.match_players
    where organization_id = p_org and player_id in (p_keep, p_duplicate)
  );

  if v_periods is not null then
    foreach v_period in array v_periods loop
      perform public.recompute_period_stats(v_period);
    end loop;
  end if;

  select array_agg(distinct match_id) into v_matches
  from public.match_events
  where organization_id = p_org and player_id = p_keep and event_type in ('goal', 'own_goal');

  if v_matches is not null then
    foreach v_match in array v_matches loop
      perform public.refresh_match_score(v_match);
    end loop;
  end if;

  if p_delete then
    delete from public.players where id = p_duplicate and organization_id = p_org;
  else
    -- Archive rather than delete — anything left unmerged stays attached
    -- to this row, out of the active squad, but not gone.
    update public.players
    set status = 'merged', merged_into_id = p_keep, jersey_number = null, updated_at = now()
    where id = p_duplicate and organization_id = p_org;
  end if;

  return jsonb_build_object(
    'keep_id', p_keep,
    'duplicate_id', p_duplicate,
    'deleted', p_delete,
    'periods_recomputed', coalesce(array_length(v_periods, 1), 0)
  );
end;
$$;
