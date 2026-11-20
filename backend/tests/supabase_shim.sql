-- TEST ONLY: minimal stand-in for the parts of Supabase the schema depends on.
-- On a real Supabase project these already exist; never run this there.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated, anon;
grant select on auth.users to authenticated;
