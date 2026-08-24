-- Merge duplicate player profiles.
--
-- Grassroots signup is self-serve, so the same person occasionally ends up
-- with two rows (a typo'd name, a re-add after they left and came back).
-- Merging combines them into one: the organizer picks which categories of
-- history — goals, assists, own goals, cards, attendance — move onto the
-- surviving profile. Categories left unchecked simply stay behind on the
-- duplicate, which is archived (not deleted) rather than destroyed, so
-- nothing is ever silently lost even if the organizer picks wrong.

alter table public.players
  add column if not exists merged_into_id uuid references public.players(id) on delete set null;

-- A merged player's shirt number should be free for reuse, same treatment
-- as 'inactive' already gets.
drop index if exists players_jersey_uniq;
create unique index players_jersey_uniq
  on public.players(organization_id, jersey_number)
  where jersey_number is not null and status not in ('inactive', 'merged');

create index if not exists players_merged_into_idx on public.players(merged_into_id);

-- ---------------------------------------------------------------------------
-- merge_players — the whole operation runs as one function so a half-applied
-- merge (some events moved, stats not recomputed) can never happen.
-- ---------------------------------------------------------------------------
create or replace function public.merge_players(
  p_org uuid,
  p_keep uuid,
  p_duplicate uuid,
  p_categories text[]
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

  -- Move the selected match_events categories over. Own goals, cards, goals
  -- and assists are all just event_type values on this table.
  if p_categories is not null and array_length(p_categories, 1) > 0 then
    update public.match_events
    set player_id = p_keep, edited_at = now()
    where organization_id = p_org
      and player_id = p_duplicate
      and event_type = any(p_categories)
      and voided_at is null;
  end if;

  -- Attendance / appearances is its own category — it lives on separate
  -- tables (session_attendance, match_players), not match_events.
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

  -- Fix "assisted by" / "scored by" cross-references on events that now
  -- point at the surviving player.
  update public.match_events
  set related_player_id = p_keep
  where organization_id = p_org and related_player_id = p_duplicate;

  -- Recompute every period touched by either profile's activity, and
  -- refresh the scoreline on every match a goal or own goal moved through.
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

  -- Archive the duplicate. Anything left unmerged stays attached to it —
  -- out of the active squad, but not gone.
  update public.players
  set status = 'merged', merged_into_id = p_keep, jersey_number = null, updated_at = now()
  where id = p_duplicate and organization_id = p_org;

  return jsonb_build_object(
    'keep_id', p_keep,
    'duplicate_id', p_duplicate,
    'periods_recomputed', coalesce(array_length(v_periods, 1), 0)
  );
end;
$$;
