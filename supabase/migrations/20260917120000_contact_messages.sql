-- ============================================================================
-- Contact form inbox.
--
-- Written only by the `contact` Edge Function (service role). RLS is on with
-- no policies, so the anon and authenticated keys can neither read nor write
-- it — same deny-all stance as every other table.
--
-- No raw IP address is stored: ip_hash is a salted SHA-256, kept only so the
-- function can rate-limit repeat senders.
-- ============================================================================

create table public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  email       text not null check (char_length(email) between 3 and 254),
  topic       text not null check (topic in ('question', 'suggestion', 'bug', 'partnership', 'other')),
  message     text not null check (char_length(message) between 10 and 2000),
  ip_hash     text not null,
  user_agent  text,
  status      text not null default 'new' check (status in ('new', 'read', 'replied', 'spam')),
  created_at  timestamptz not null default now()
);

create index contact_messages_ip_recent on public.contact_messages (ip_hash, created_at desc);
create index contact_messages_email_recent on public.contact_messages (email, created_at desc);
create index contact_messages_created on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
