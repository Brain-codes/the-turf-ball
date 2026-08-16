-- Onboarding rebuild: self-serve player invites + a Storage bucket for photos.
--
-- 1. player_status gains 'pending' — a player who submitted themselves via
--    the invite link but has not yet been approved by an admin. They are
--    invisible everywhere a normal roster query runs (list.ts excludes
--    'inactive' by default but NOT 'pending' automatically, so handlers that
--    should hide pending rows filter it explicitly — see players/handlers/list.ts).
--
-- 2. A public Storage bucket for player headshots. Clients never talk to
--    Storage directly (rule2.txt) — every upload goes through an Edge
--    Function using the service-role key, exactly like every other write in
--    this project. The bucket is public-READ only so photo URLs work in
--    <img> tags on the public share page and in the app without a signed
--    URL round trip; there are no INSERT/UPDATE/DELETE policies for anon or
--    authenticated roles at all, because those roles never touch Storage —
--    only the service-role key (which bypasses RLS/policies entirely) does.

alter type player_status add value if not exists 'pending';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
