-- Run once in the Supabase SQL editor.
-- The whole database is one JSON document in a single row. `rev` is bumped on
-- every save so concurrent server instances cannot overwrite each other.
create table if not exists public.acmedesk_db (
  id   text primary key,
  data jsonb  not null,
  rev  bigint not null default 1
);

-- Only the server (service role key) touches this table. With RLS on and no
-- policies, the public anon key cannot read or write it.
alter table public.acmedesk_db enable row level security;

