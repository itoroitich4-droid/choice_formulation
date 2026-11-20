-- Choice Nutrition feed workspace: schema, row-level security and integrity triggers.
-- Run in the Supabase SQL editor (or `supabase db push`). Requires Supabase Auth (auth.users, auth.uid()).
-- The FastAPI service connects to this database and runs every request as the signed-in user
-- (SET LOCAL ROLE authenticated + the user's JWT claims), so the rules below are enforced by PostgreSQL itself.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- members
create table if not exists public.company_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('admin','nutritionist','formulator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers
create or replace function public.jwt_email() returns text
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true), ''), '')::jsonb ->> 'email'
$$;

create or replace function public.member_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.company_members where user_id = (select auth.uid()) and active
$$;

create or replace function public.has_role(allowed text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = any(allowed) from public.company_members
                   where user_id = (select auth.uid()) and active), false)
$$;

revoke all on function public.member_role() from public, anon;
revoke all on function public.has_role(text[]) from public, anon;
grant execute on function public.member_role() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;

-- ---------------------------------------------------------------- tables
create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  cost_per_kg numeric(14,4) check (cost_per_kg is null or cost_per_kg >= 0),
  pack text,
  source text,
  nutrients jsonb not null default '{}'::jsonb,   -- {"protein": 12.5, "energy": 3300, ...}; missing = unknown
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ingredients_name_uq on public.ingredients (lower(name));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('premix','finished_feed')),
  animal text,
  pack text,
  description text,
  targets jsonb not null default '{}'::jsonb,     -- {"protein": {"min": 16, "max": 18}, ...}
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_name_uq on public.products (lower(name));

create table if not exists public.formulations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  version int not null check (version >= 1),
  kind text not null check (kind in ('premix','finished_feed')),
  animal text,
  batch_size_kg numeric(14,4) not null check (batch_size_kg > 0),
  notes text,
  targets jsonb not null default '{}'::jsonb,
  -- [{"ref_type":"ingredient"|"premix","ref_id":uuid,"name":text,"quantity_kg":n,"min_pct":n|null,"max_pct":n|null,
  --   "snapshot":{"cost_per_kg":n|null,"nutrients":{...}}}]
  lines jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected','superseded')),
  created_by uuid default auth.uid(),
  created_by_email text default public.jwt_email(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by_email text,
  reviewed_at timestamptz,
  reviewed_by_email text,
  review_note text,
  superseded_by_version int,
  unique (product_id, version)
);
create index if not exists formulations_product_idx on public.formulations (product_id, version desc);
create index if not exists formulations_status_idx on public.formulations (status);

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  formulation_id uuid not null references public.formulations(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  version int not null,
  batch_count numeric(12,3) not null check (batch_count > 0),
  total_kg numeric(16,4) not null check (total_kg > 0),
  lot text,
  produced_on date not null default current_date,
  prepared_by text,
  lines jsonb not null,
  created_by uuid default auth.uid(),
  created_by_email text default public.jwt_email(),
  created_at timestamptz not null default now()
);
create index if not exists batches_date_idx on public.batches (produced_on desc);

create table if not exists public.audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  actor_email text default public.jwt_email(),
  event text not null,
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------- integrity triggers
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists ingredients_touch on public.ingredients;
create trigger ingredients_touch before update on public.ingredients
  for each row execute function public.touch_updated_at();
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Recipe version rules. Approved/returned/superseded versions are permanent records; only drafts can be edited.
create or replace function public.formulations_guard() returns trigger
language plpgsql as $$
declare r text := public.member_role();
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New recipe versions must start as drafts' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.product_id <> old.product_id or new.version <> old.version or new.kind <> old.kind
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'Product, version and creator of a recipe version cannot change' using errcode = '42501';
  end if;

  -- content edits: drafts only
  if (new.animal, new.batch_size_kg, new.notes, new.targets, new.lines, new.summary)
       is distinct from (old.animal, old.batch_size_kg, old.notes, old.targets, old.lines, old.summary)
     and not (old.status = 'draft' and new.status in ('draft','pending')) then
    raise exception 'Only draft recipe versions can be edited; create a new version instead' using errcode = '42501';
  end if;

  if new.status = old.status then
    if old.status = 'draft' and r = 'formulator' and old.created_by is distinct from (select auth.uid()) then
      raise exception 'Formulators can only edit their own drafts' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'pending' then
    if r = 'formulator' and old.created_by is distinct from (select auth.uid()) then
      raise exception 'Formulators can only submit their own drafts' using errcode = '42501';
    end if;
    new.submitted_at := now();
    new.submitted_by_email := public.jwt_email();
  elsif old.status = 'pending' and new.status in ('approved','rejected') then
    if r not in ('admin','nutritionist') then
      raise exception 'Only a nutritionist or administrator can approve or return a recipe' using errcode = '42501';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.review_note), '') = '' then
      raise exception 'A reason is required when returning a recipe' using errcode = '23514';
    end if;
    new.reviewed_at := now();
    new.reviewed_by_email := public.jwt_email();
  elsif old.status = 'approved' and new.status = 'superseded' then
    if r not in ('admin','nutritionist') or new.superseded_by_version is null then
      raise exception 'Only approving a newer version can supersede a recipe' using errcode = '42501';
    end if;
  else
    raise exception 'Recipe status cannot change from % to %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists formulations_guard_trg on public.formulations;
create trigger formulations_guard_trg before insert or update on public.formulations
  for each row execute function public.formulations_guard();

-- Approving a version supersedes the previously approved version of the same product.
create or replace function public.formulations_supersede() returns trigger
language plpgsql as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    update public.formulations
       set status = 'superseded', superseded_by_version = new.version
     where product_id = new.product_id and status = 'approved' and id <> new.id;
  end if;
  return null;
end $$;

drop trigger if exists formulations_supersede_trg on public.formulations;
create trigger formulations_supersede_trg after update on public.formulations
  for each row execute function public.formulations_supersede();

-- Production batches may only be made from an approved version, and are never edited.
create or replace function public.batches_guard() returns trigger
language plpgsql as $$
declare f public.formulations;
begin
  select * into f from public.formulations where id = new.formulation_id;
  if f.id is null or f.status <> 'approved' then
    raise exception 'Production batches can only be made from an approved recipe version' using errcode = '23514';
  end if;
  new.product_id := f.product_id;
  new.version := f.version;
  return new;
end $$;

drop trigger if exists batches_guard_trg on public.batches;
create trigger batches_guard_trg before insert on public.batches
  for each row execute function public.batches_guard();

-- ---------------------------------------------------------------- row-level security
alter table public.company_members enable row level security;
alter table public.ingredients     enable row level security;
alter table public.products        enable row level security;
alter table public.formulations    enable row level security;
alter table public.batches         enable row level security;
alter table public.audit_events    enable row level security;

drop policy if exists members_read on public.company_members;
create policy members_read on public.company_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role(array['admin'])));
drop policy if exists members_admin_write on public.company_members;
create policy members_admin_write on public.company_members for all to authenticated
  using ((select public.has_role(array['admin']))) with check ((select public.has_role(array['admin'])));

drop policy if exists ingredients_read on public.ingredients;
create policy ingredients_read on public.ingredients for select to authenticated
  using ((select public.member_role()) is not null);
drop policy if exists ingredients_write on public.ingredients;
create policy ingredients_write on public.ingredients for insert to authenticated
  with check ((select public.has_role(array['admin','nutritionist'])));
drop policy if exists ingredients_update on public.ingredients;
create policy ingredients_update on public.ingredients for update to authenticated
  using ((select public.has_role(array['admin','nutritionist'])))
  with check ((select public.has_role(array['admin','nutritionist'])));

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated
  using ((select public.member_role()) is not null);
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
  with check ((select public.has_role(array['admin','nutritionist','formulator'])));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
  using ((select public.has_role(array['admin','nutritionist'])))
  with check ((select public.has_role(array['admin','nutritionist'])));

drop policy if exists formulations_read on public.formulations;
create policy formulations_read on public.formulations for select to authenticated
  using ((select public.member_role()) is not null);
drop policy if exists formulations_insert on public.formulations;
create policy formulations_insert on public.formulations for insert to authenticated
  with check ((select public.has_role(array['admin','nutritionist','formulator'])) and status = 'draft');
drop policy if exists formulations_update on public.formulations;
create policy formulations_update on public.formulations for update to authenticated
  using ((select public.has_role(array['admin','nutritionist','formulator'])))
  with check ((select public.has_role(array['admin','nutritionist','formulator'])));

drop policy if exists batches_read on public.batches;
create policy batches_read on public.batches for select to authenticated
  using ((select public.member_role()) is not null);
drop policy if exists batches_insert on public.batches;
create policy batches_insert on public.batches for insert to authenticated
  with check ((select public.has_role(array['admin','nutritionist','formulator'])));

drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events for select to authenticated
  using ((select public.member_role()) is not null);
drop policy if exists audit_insert on public.audit_events;
create policy audit_insert on public.audit_events for insert to authenticated
  with check ((select public.member_role()) is not null and actor = (select auth.uid()));

-- ---------------------------------------------------------------- privileges (no DELETE anywhere; no anonymous access)
revoke all on public.company_members, public.ingredients, public.products, public.formulations,
              public.batches, public.audit_events from anon, authenticated;
grant select, insert, update on public.company_members, public.ingredients, public.products,
              public.formulations to authenticated;
grant select, insert on public.batches, public.audit_events to authenticated;
grant usage, select on sequence public.audit_events_id_seq to authenticated;
