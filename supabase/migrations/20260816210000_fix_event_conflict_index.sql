-- events/handlers/record.ts upserts with onConflict: 'match_id,client_key' so a
-- retried write can never double-count a goal. Postgrest's upsert builds a
-- plain `ON CONFLICT (match_id, client_key)`, which Postgres can only resolve
-- against a plain unique constraint — not the partial index this started with
-- (`where client_key is not null`), producing "no unique or exclusion
-- constraint matching the ON CONFLICT specification" on every real write.
--
-- A plain unique index already treats NULL as distinct from every other NULL,
-- so dropping the partial predicate keeps the original intent (rows with no
-- client_key never conflict with each other) while making ON CONFLICT work.
drop index public.match_events_client_key_uniq;

create unique index match_events_client_key_uniq
  on public.match_events(match_id, client_key);
