-- ============================================================================
-- Group finances.
--
-- Each group can switch this on for itself (organizations.finance_enabled,
-- owner/admin only, default OFF). Players pay the admin by cash or transfer
-- as they do today; the admin records it here and the app keeps the balance.
--
-- 1. finance_settings   — per group: currency, monthly fee, game fee.
-- 2. player_finance     — per player: monthly / pay-as-you-play / free, with
--                         optional personal fees. Missing row = group default.
-- 3. finance_subscriptions — one row per paid-for month (or months). The
--                         cycle runs from the day they started: joined on the
--                         16th, due again on the 16th.
-- 4. finance_entries    — the ledger. Charges, payments and credits. Never
--                         deleted, only voided with a reason, so every naira
--                         can be traced. balance = charges - payments - credits.
-- 5. Game fees are added automatically: a trigger on session_attendance
--    charges anyone ticked in who isn't on a live monthly plan (or free), and
--    voids that charge if they are unticked or the session is cancelled.
--    Recording a monthly payment voids game fees it now covers.
-- 6. merge_players moves money with the person.
--
-- All tables RLS deny-all, like everything else. Only admins/owners reach
-- them, through the `finance` Edge Function.
-- ============================================================================

alter table public.organizations
  add column if not exists finance_enabled boolean not null default false;

alter table public.players
  add column if not exists phone text;

insert into public.platform_features (key, label, description) values
  ('finance', 'Group finances', 'Groups can track subscriptions, game fees and who owes what.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.finance_settings (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  currency            text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  monthly_fee         numeric(12,2) not null default 0 check (monthly_fee >= 0),
  game_fee            numeric(12,2) not null default 0 check (game_fee >= 0),
  default_plan        text not null default 'per_game' check (default_plan in ('monthly', 'per_game', 'exempt')),
  remind_days_before  int not null default 3 check (remind_days_before between 0 and 14),
  charge_guests       boolean not null default true,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id) on delete set null
);

create table public.player_finance (
  player_id        uuid primary key references public.players(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  plan             text not null check (plan in ('monthly', 'per_game', 'exempt')),
  monthly_fee      numeric(12,2) check (monthly_fee >= 0),
  game_fee         numeric(12,2) check (game_fee >= 0),
  plan_changed_at  timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index player_finance_org on public.player_finance (organization_id);

create table public.finance_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  player_id        uuid not null references public.players(id) on delete cascade,
  starts_on        date not null,
  ends_on          date not null,
  months           int not null default 1 check (months between 1 and 12),
  amount           numeric(12,2) not null check (amount >= 0),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references public.profiles(id) on delete set null,
  constraint subscription_range check (ends_on > starts_on)
);
create index finance_subscriptions_player on public.finance_subscriptions (player_id, ends_on desc) where voided_at is null;
create index finance_subscriptions_org on public.finance_subscriptions (organization_id, ends_on) where voided_at is null;

create table public.finance_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  player_id        uuid not null references public.players(id) on delete cascade,
  kind             text not null check (kind in ('charge', 'payment', 'credit')),
  source           text not null default 'manual' check (source in ('manual', 'game', 'subscription')),
  amount           numeric(12,2) not null check (amount > 0),
  description      text,
  method           text check (method in ('cash', 'transfer', 'card', 'other')),
  entry_date       date not null default current_date,
  session_id       uuid references public.sessions(id) on delete set null,
  subscription_id  uuid references public.finance_subscriptions(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references public.profiles(id) on delete set null,
  void_reason      text,
  constraint payment_has_method check (kind <> 'payment' or method is not null)
);
create index finance_entries_player on public.finance_entries (player_id, entry_date desc);
create index finance_entries_org on public.finance_entries (organization_id, created_at desc);
create index finance_entries_session on public.finance_entries (session_id) where session_id is not null;
-- One live game fee per player per session.
create unique index finance_entries_one_game_charge
  on public.finance_entries (player_id, session_id)
  where kind = 'charge' and source = 'game' and voided_at is null;

alter table public.finance_settings      enable row level security;
alter table public.player_finance        enable row level security;
alter table public.finance_subscriptions enable row level security;
alter table public.finance_entries       enable row level security;

-- ---------------------------------------------------------------------------
-- Today, in the group's own timezone.
-- ---------------------------------------------------------------------------

create or replace function public.org_today(p_org uuid)
returns date
language sql
stable
as $$
  select (now() at time zone coalesce((select timezone from public.organizations where id = p_org), 'Africa/Lagos'))::date;
$$;

-- ---------------------------------------------------------------------------
-- Game fees
-- ---------------------------------------------------------------------------

/**
 * Bring one player's game fee for one session in line with reality:
 *   present + not covered + fee > 0  -> exactly one live charge
 *   not present / session cancelled  -> no live charge
 * Finance switched off: leave everything as it is (history stays; nothing new).
 */
create or replace function public.finance_sync_game_charge(p_session uuid, p_player uuid)
returns void
language plpgsql
as $$
declare
  v_org        uuid;
  v_date       date;
  v_status     session_status;
  v_title      text;
  v_enabled    boolean;
  v_present    boolean;
  v_settings   public.finance_settings%rowtype;
  v_plan       text;
  v_fee        numeric;
  v_pstatus    player_status;
  v_covered    boolean;
begin
  select organization_id, session_date, status, title
    into v_org, v_date, v_status, v_title
  from public.sessions where id = p_session;
  if v_org is null then return; end if;

  select finance_enabled into v_enabled from public.organizations where id = v_org;
  if not coalesce(v_enabled, false) then return; end if;

  select exists (
    select 1 from public.session_attendance
    where session_id = p_session and player_id = p_player and status = 'present'
  ) into v_present;

  if not v_present or v_status = 'cancelled' then
    update public.finance_entries
       set voided_at = now(),
           void_reason = case when v_status = 'cancelled' then 'Session was cancelled' else 'No longer marked present' end
     where session_id = p_session and player_id = p_player
       and kind = 'charge' and source = 'game' and voided_at is null;
    return;
  end if;

  select * into v_settings from public.finance_settings where organization_id = v_org;
  select status into v_pstatus from public.players where id = p_player;

  select pf.plan, coalesce(pf.game_fee, v_settings.game_fee)
    into v_plan, v_fee
  from public.player_finance pf where pf.player_id = p_player;
  if v_plan is null then
    v_plan := coalesce(v_settings.default_plan, 'per_game');
    v_fee  := v_settings.game_fee;
  end if;
  if v_pstatus = 'guest' and not coalesce(v_settings.charge_guests, true) then
    v_plan := 'exempt';
  end if;

  select exists (
    select 1 from public.finance_subscriptions
    where player_id = p_player and voided_at is null
      and v_date >= starts_on and v_date < ends_on
  ) into v_covered;

  if v_plan = 'exempt' or v_covered or coalesce(v_fee, 0) <= 0 then
    return;
  end if;

  insert into public.finance_entries
    (organization_id, player_id, kind, source, amount, description, entry_date, session_id)
  values
    (v_org, p_player, 'charge', 'game', v_fee,
     case when v_plan = 'monthly'
          then 'Game fee (monthly plan not active on this date)'
          else 'Game fee' end
       || coalesce(' — ' || nullif(v_title, ''), ''),
     v_date, p_session)
  on conflict (player_id, session_id) where kind = 'charge' and source = 'game' and voided_at is null
  do nothing;
end;
$$;

create or replace function public.finance_attendance_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.finance_sync_game_charge(old.session_id, old.player_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = new.status and old.player_id = new.player_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.player_id <> new.player_id then
    perform public.finance_sync_game_charge(old.session_id, old.player_id);
  end if;
  perform public.finance_sync_game_charge(new.session_id, new.player_id);
  return new;
end;
$$;

create trigger session_attendance_finance
  after insert or update of status, player_id or delete on public.session_attendance
  for each row execute function public.finance_attendance_trigger();

create or replace function public.finance_session_trigger()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.status is distinct from old.status
     and (new.status = 'cancelled' or old.status = 'cancelled') then
    for r in select player_id from public.session_attendance where session_id = new.id loop
      perform public.finance_sync_game_charge(new.id, r.player_id);
    end loop;
    -- Anyone charged but no longer on the attendance list.
    for r in select distinct player_id from public.finance_entries
             where session_id = new.id and kind = 'charge' and source = 'game' and voided_at is null loop
      perform public.finance_sync_game_charge(new.id, r.player_id);
    end loop;
  end if;
  return new;
end;
$$;

create trigger sessions_finance
  after update of status on public.sessions
  for each row execute function public.finance_session_trigger();

-- ---------------------------------------------------------------------------
-- Monthly plans
-- ---------------------------------------------------------------------------

/**
 * Record a paid-for month (or several). Atomic: the subscription, its charge,
 * the optional payment, and voiding any game fees the new period covers.
 */
create or replace function public.finance_record_subscription(
  p_org        uuid,
  p_player     uuid,
  p_actor      uuid,
  p_starts_on  date,
  p_months     int,
  p_amount     numeric,
  p_paid       numeric,
  p_method     text,
  p_note       text
)
returns jsonb
language plpgsql
as $$
declare
  v_sub     uuid;
  v_ends    date;
  v_charge  uuid;
  v_payment uuid;
  v_voided  int;
begin
  perform 1 from public.players where id = p_player and organization_id = p_org;
  if not found then raise exception 'Player not found'; end if;
  if p_months < 1 or p_months > 12 then raise exception 'Months must be between 1 and 12'; end if;
  if p_amount < 0 or coalesce(p_paid, 0) < 0 then raise exception 'Amounts cannot be negative'; end if;

  v_ends := (p_starts_on + make_interval(months => p_months))::date;

  if exists (
    select 1 from public.finance_subscriptions
    where player_id = p_player and voided_at is null
      and starts_on < v_ends and p_starts_on < ends_on
  ) then
    raise exception 'This overlaps a month already recorded for this player';
  end if;

  insert into public.finance_subscriptions (organization_id, player_id, starts_on, ends_on, months, amount, created_by)
  values (p_org, p_player, p_starts_on, v_ends, p_months, p_amount, p_actor)
  returning id into v_sub;

  if p_amount > 0 then
    insert into public.finance_entries
      (organization_id, player_id, kind, source, amount, description, entry_date, subscription_id, created_by)
    values
      (p_org, p_player, 'charge', 'subscription', p_amount,
       case when p_months = 1 then 'Monthly subscription' else p_months || '-month subscription' end
         || ' (' || to_char(p_starts_on, 'DD Mon') || ' – ' || to_char(v_ends, 'DD Mon YYYY') || ')',
       p_starts_on, v_sub, p_actor)
    returning id into v_charge;
  end if;

  if coalesce(p_paid, 0) > 0 then
    insert into public.finance_entries
      (organization_id, player_id, kind, source, amount, description, method, entry_date, subscription_id, created_by)
    values
      (p_org, p_player, 'payment', 'subscription', p_paid,
       coalesce(nullif(trim(p_note), ''), 'Subscription payment'),
       coalesce(p_method, 'cash'), public.org_today(p_org), v_sub, p_actor)
    returning id into v_payment;
  end if;

  -- Paying for a month puts them on the monthly plan from here on.
  insert into public.player_finance (player_id, organization_id, plan)
  values (p_player, p_org, 'monthly')
  on conflict (player_id) do update
    set plan = 'monthly',
        plan_changed_at = case when public.player_finance.plan <> 'monthly' then now() else public.player_finance.plan_changed_at end,
        updated_at = now();

  update public.finance_entries
     set voided_at = now(), voided_by = p_actor, void_reason = 'Covered by monthly subscription'
   where player_id = p_player and kind = 'charge' and source = 'game' and voided_at is null
     and entry_date >= p_starts_on and entry_date < v_ends;
  get diagnostics v_voided = row_count;

  return jsonb_build_object(
    'subscription_id', v_sub, 'ends_on', v_ends,
    'charge_id', v_charge, 'payment_id', v_payment, 'game_fees_cleared', v_voided
  );
end;
$$;

/**
 * Void one ledger entry. Voiding a subscription charge also voids the
 * subscription and re-applies game fees for sessions it had covered.
 */
create or replace function public.finance_void_entry(p_org uuid, p_entry uuid, p_actor uuid, p_reason text)
returns jsonb
language plpgsql
as $$
declare
  v_entry public.finance_entries%rowtype;
  v_sub   public.finance_subscriptions%rowtype;
  r       record;
begin
  select * into v_entry from public.finance_entries where id = p_entry and organization_id = p_org for update;
  if not found then raise exception 'Entry not found'; end if;
  if v_entry.voided_at is not null then raise exception 'Already cancelled'; end if;

  update public.finance_entries
     set voided_at = now(), voided_by = p_actor, void_reason = p_reason
   where id = p_entry;

  if v_entry.kind = 'charge' and v_entry.source = 'subscription' and v_entry.subscription_id is not null then
    update public.finance_subscriptions set voided_at = now(), voided_by = p_actor
     where id = v_entry.subscription_id and voided_at is null
     returning * into v_sub;

    if v_sub.id is not null then
      for r in
        select sa.session_id
        from public.session_attendance sa
        join public.sessions s on s.id = sa.session_id
        where sa.player_id = v_entry.player_id and sa.status = 'present'
          and s.session_date >= v_sub.starts_on and s.session_date < v_sub.ends_on
      loop
        perform public.finance_sync_game_charge(r.session_id, v_entry.player_id);
      end loop;
    end if;
  end if;

  return jsonb_build_object('id', p_entry, 'subscription_voided', v_sub.id is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- The dashboard, in one query.
-- ---------------------------------------------------------------------------

create or replace function public.finance_player_rows(p_org uuid)
returns table (
  player_id        uuid,
  display_name     text,
  whatsapp_nickname text,
  photo_url        text,
  phone            text,
  player_status    player_status,
  plan             text,
  monthly_fee      numeric,
  game_fee         numeric,
  charged          numeric,
  paid             numeric,
  credited         numeric,
  balance          numeric,
  sub_starts_on    date,
  sub_ends_on      date,
  last_payment_on  date,
  games_this_month int
)
language sql
stable
as $$
  with s as (
    select coalesce(fs.monthly_fee, 0) as monthly_fee, coalesce(fs.game_fee, 0) as game_fee,
           coalesce(fs.default_plan, 'per_game') as default_plan
    from (select 1) one
    left join public.finance_settings fs on fs.organization_id = p_org
  ),
  ledger as (
    select e.player_id,
           sum(e.amount) filter (where e.kind = 'charge')  as charged,
           sum(e.amount) filter (where e.kind = 'payment') as paid,
           sum(e.amount) filter (where e.kind = 'credit')  as credited,
           max(e.entry_date) filter (where e.kind = 'payment') as last_payment_on
    from public.finance_entries e
    where e.organization_id = p_org and e.voided_at is null
    group by e.player_id
  ),
  latest_sub as (
    select distinct on (fs.player_id) fs.player_id, fs.starts_on, fs.ends_on
    from public.finance_subscriptions fs
    where fs.organization_id = p_org and fs.voided_at is null
    order by fs.player_id, fs.ends_on desc
  ),
  games as (
    select sa.player_id, count(*)::int as n
    from public.session_attendance sa
    join public.sessions se on se.id = sa.session_id
    where sa.organization_id = p_org and sa.status = 'present' and se.status <> 'cancelled'
      and date_trunc('month', se.session_date) = date_trunc('month', public.org_today(p_org))
    group by sa.player_id
  )
  select p.id, p.display_name, p.whatsapp_nickname, p.photo_url, p.phone, p.status,
         coalesce(pf.plan, s.default_plan),
         coalesce(pf.monthly_fee, s.monthly_fee),
         coalesce(pf.game_fee, s.game_fee),
         coalesce(l.charged, 0), coalesce(l.paid, 0), coalesce(l.credited, 0),
         coalesce(l.charged, 0) - coalesce(l.paid, 0) - coalesce(l.credited, 0),
         ls.starts_on, ls.ends_on, l.last_payment_on,
         coalesce(g.n, 0)
  from public.players p
  cross join s
  left join public.player_finance pf on pf.player_id = p.id
  left join ledger l on l.player_id = p.id
  left join latest_sub ls on ls.player_id = p.id
  left join games g on g.player_id = p.id
  where p.organization_id = p_org
    and (p.status in ('active', 'guest') or coalesce(l.charged, 0) - coalesce(l.paid, 0) - coalesce(l.credited, 0) <> 0)
    and p.status not in ('pending', 'merged')
  order by p.display_name;
$$;

-- ---------------------------------------------------------------------------
-- Merging players: money follows the person.
-- Same function as 20260824030000, plus the finance block before the delete.
-- ---------------------------------------------------------------------------

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

  -- Money moves before attendance, so the attendance trigger doesn't
  -- re-charge the kept player for a session the duplicate already paid for.
  -- A game fee both players hold for the same session: keep one, void the other.
  update public.finance_entries d
     set voided_at = now(), void_reason = 'Duplicate game fee removed when players were merged'
   where d.player_id = p_duplicate and d.organization_id = p_org
     and d.kind = 'charge' and d.source = 'game' and d.voided_at is null
     and exists (
       select 1 from public.finance_entries k
       where k.player_id = p_keep and k.session_id = d.session_id
         and k.kind = 'charge' and k.source = 'game' and k.voided_at is null
     );
  update public.finance_entries set player_id = p_keep
   where player_id = p_duplicate and organization_id = p_org;
  update public.finance_subscriptions set player_id = p_keep
   where player_id = p_duplicate and organization_id = p_org;
  if exists (select 1 from public.player_finance where player_id = p_keep) then
    delete from public.player_finance where player_id = p_duplicate;
  else
    update public.player_finance set player_id = p_keep where player_id = p_duplicate;
  end if;
  update public.players k
     set phone = d.phone
    from public.players d
   where k.id = p_keep and d.id = p_duplicate and k.phone is null and d.phone is not null;

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
