-- ============================================================================
-- Fixture generation settings, remembered per competition.
--
-- "Generate fixtures" used to bake in one fixed shape: back-to-back
-- kickoffs from local midnight on a single day, or a naive even spread
-- across days with no time-of-day at all for multi-day competitions. That
-- meant a) matches "started" at 00:00 until an admin manually dragged every
-- single one, b) there was no way to say "we can only play 4 matches a
-- day" or "two pitches are free, so two matches run at once", and c)
-- pressing Generate a second time just added a whole second round-robin's
-- worth of fixtures on top instead of replacing the draft schedule.
--
-- These columns hold the organizer's actual answers (minutes per match,
-- how many matches a day, the daily start/end window, how many pitches run
-- at once) so regenerating reuses them without re-asking, and so the
-- schedule itself is right the first time instead of needing a manual drag
-- pass over every fixture.
-- ============================================================================

alter table public.competitions
  add column day_starts_at time,
  add column matches_per_day integer check (matches_per_day is null or matches_per_day between 1 and 200),
  add column concurrent_matches integer not null default 1 check (concurrent_matches between 1 and 20);

comment on column public.competitions.day_starts_at is
  'Daily play window start (e.g. 16:00). Paired with day_ends_at to bound when fixtures can be scheduled each day.';
comment on column public.competitions.matches_per_day is
  'Explicit cap on fixtures per day. Null = worked out automatically from the daily window and match duration.';
comment on column public.competitions.concurrent_matches is
  'How many fixtures can be scheduled at the same kickoff time (multiple pitches running at once). Default 1 = one at a time.';
