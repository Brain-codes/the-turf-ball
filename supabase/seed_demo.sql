-- ============================================================================
-- Demo data — a fully played month, so the app can be seen full rather than empty.
--
-- Run this ONLY against a scratch database or immediately after signing up,
-- and pass your own auth user id. It creates a second organization owned by
-- you; it does not touch anything you already have.
--
--   psql "$DATABASE_URL" -v owner_id="'<your-auth-user-uuid>'" -f supabase/seed_demo.sql
--
-- To remove it afterwards:
--   delete from public.organizations where slug = 'demo-sunday-ballers';
-- ============================================================================

\set ON_ERROR_STOP on

-- psql does not substitute variables inside a dollar-quoted block, so the id
-- is handed over through a session setting instead.
select set_config('turfball.demo_owner', :'owner_id', false);

do $$
declare
  v_owner   uuid := current_setting('turfball.demo_owner')::uuid;
  v_org     uuid;
  v_period  uuid;
  v_session uuid;
  v_match   uuid;
  v_names   text[] := array[
    'Ade','Mike','John','Sam','Tony','Chidi','Bola','Femi','Kunle','Segun',
    'Emeka','Yusuf','Tunde','Ibrahim','Dami','Kelechi','Uche','Seyi','Musa','Gbenga'
  ];
  v_player  uuid;
  v_players uuid[];
  v_side_a  uuid[];
  v_side_b  uuid[];
  v_scorer  uuid;
  v_assist  uuid;
  i int; s int; m int; g int;
begin
  if not exists (select 1 from public.profiles where id = v_owner) then
    raise exception 'No profile for %. Sign up first, then pass your user id.', v_owner;
  end if;

  insert into public.organizations (
    owner_id, name, short_name, slug, venue, location,
    format, players_per_side, playing_days, default_kickoff, timezone
  ) values (
    v_owner, 'Demo Sunday Ballers', 'DSB', 'demo-sunday-ballers',
    'Greenfield Arena', 'Abuja', '5aside', 5, array['Sunday'], '17:00', 'Africa/Lagos'
  ) returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org, v_owner, 'owner', 'active');

  insert into public.org_settings (organization_id) values (v_org);
  insert into public.public_pages (organization_id, slug) values (v_org, 'demo-sunday-ballers');
  perform public.seed_default_scoring_rules(v_org);
  v_period := public.ensure_open_period(v_org);

  -- Squad
  for i in 1 .. array_length(v_names, 1) loop
    insert into public.players (
      organization_id, first_name, display_name, jersey_number, position, status
    ) values (
      v_org,
      v_names[i],
      v_names[i],
      i,
      (array['GK','DEF','MID','FWD'])[1 + ((i - 1) % 4)]::player_position,
      'active'
    ) returning id into v_player;
    v_players := array_append(v_players, v_player);
  end loop;

  -- Four Sundays, two matches each
  for s in 1 .. 4 loop
    insert into public.sessions (
      organization_id, period_id, session_date, kickoff_at, venue, status, created_by
    ) values (
      v_org, v_period,
      (current_date - ((4 - s) * 7))::date,
      (current_date - ((4 - s) * 7))::date + time '17:00',
      'Greenfield Arena', 'completed', v_owner
    ) returning id into v_session;

    -- Attendance: 14 of the 20 turn up, with a spread of arrival times
    for i in 1 .. 14 loop
      insert into public.session_attendance (
        organization_id, session_id, player_id, status,
        arrived_at, punctuality_band, punctuality_points
      ) values (
        v_org, v_session, v_players[((i + s) % 20) + 1], 'present',
        (current_date - ((4 - s) * 7))::date + time '17:00' - ((10 - i) * interval '2 minutes'),
        (case when i <= 5 then 'early' when i <= 10 then 'on_time' else 'late' end)::punctuality_band,
        (case when i <= 5 then 2 when i <= 10 then 1 else 0 end)
      );
    end loop;

    for m in 1 .. 2 loop
      v_side_a := array[]::uuid[];
      v_side_b := array[]::uuid[];

      for i in 1 .. 10 loop
        if i % 2 = 0 then
          v_side_a := array_append(v_side_a, v_players[((i + s + m) % 20) + 1]);
        else
          v_side_b := array_append(v_side_b, v_players[((i + s + m) % 20) + 1]);
        end if;
      end loop;

      insert into public.matches (
        organization_id, session_id, sequence, duration_minutes,
        started_at, ended_at, status, created_by
      ) values (
        v_org, v_session, m, 20,
        (current_date - ((4 - s) * 7))::date + time '17:00',
        (current_date - ((4 - s) * 7))::date + time '17:25',
        'completed', v_owner
      ) returning id into v_match;

      insert into public.match_players (organization_id, match_id, player_id, side, is_goalkeeper)
      select v_org, v_match, p, 'a', (ordinality = 1) from unnest(v_side_a) with ordinality as t(p, ordinality)
      on conflict do nothing;

      insert into public.match_players (organization_id, match_id, player_id, side, is_goalkeeper)
      select v_org, v_match, p, 'b', (ordinality = 1) from unnest(v_side_b) with ordinality as t(p, ordinality)
      on conflict do nothing;

      -- A handful of goals, most of them assisted
      for g in 1 .. (2 + (s + m) % 3) loop
        v_scorer := v_side_a[1 + ((g + s) % array_length(v_side_a, 1))];
        v_assist := v_side_a[1 + ((g + s + 2) % array_length(v_side_a, 1))];

        insert into public.match_events (
          organization_id, match_id, session_id, period_id,
          player_id, related_player_id, event_type, side, minute, metadata, created_by
        ) values (
          v_org, v_match, v_session, v_period,
          v_scorer,
          case when v_assist <> v_scorer then v_assist else null end,
          'goal', 'a', g * 3,
          jsonb_build_object('group_id', gen_random_uuid()), v_owner
        );

        if v_assist <> v_scorer then
          insert into public.match_events (
            organization_id, match_id, session_id, period_id,
            player_id, related_player_id, event_type, side, minute, metadata, created_by
          ) values (
            v_org, v_match, v_session, v_period,
            v_assist, v_scorer, 'assist', 'a', g * 3,
            jsonb_build_object('group_id', gen_random_uuid()), v_owner
          );
        end if;
      end loop;

      -- Side B pull one back
      insert into public.match_events (
        organization_id, match_id, session_id, period_id,
        player_id, event_type, side, minute, created_by
      ) values (
        v_org, v_match, v_session, v_period,
        v_side_b[2], 'goal', 'b', 15, v_owner
      );

      -- The odd card
      if (s + m) % 3 = 0 then
        insert into public.match_events (
          organization_id, match_id, session_id, period_id,
          player_id, event_type, side, minute, created_by
        ) values (v_org, v_match, v_session, v_period, v_side_b[3], 'yellow_card', 'b', 12, v_owner);
      end if;

      perform public.refresh_match_score(v_match);
    end loop;
  end loop;

  perform public.recompute_period_stats(v_period);

  raise notice 'Demo group created. Share page: /t/demo-sunday-ballers';
end $$;
