-- Adds a WhatsApp nickname to player profiles — the name the player goes by
-- in the group's WhatsApp chat, distinct from their kit/display name.
alter table public.players
  add column whatsapp_nickname text;
