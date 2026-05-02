-- ===========================================================================
-- Tekaida — Supabase schema
-- Run this once in your Supabase project's SQL Editor:
--   Dashboard → SQL Editor → New query → paste this whole file → Run
-- ===========================================================================

-- 1. The generations table -- one row per finished generation across all
--    output types (video / image / deck / infographic / book).

create table if not exists public.generations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  output_type text not null check (output_type in ('video','image','deck','infographic','book')),
  title       text,
  concept     text not null,
  provider    text,
  output_url  text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists generations_user_created_idx
  on public.generations (user_id, created_at desc);

-- 2. Row-level security -- each user only sees and writes their own rows.

alter table public.generations enable row level security;

drop policy if exists "users select own generations" on public.generations;
create policy "users select own generations"
  on public.generations for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own generations" on public.generations;
create policy "users insert own generations"
  on public.generations for insert
  with check (auth.uid() = user_id);

drop policy if exists "users delete own generations" on public.generations;
create policy "users delete own generations"
  on public.generations for delete
  using (auth.uid() = user_id);

-- 3. (Optional) Profile table -- stores display name etc. Not used yet but
--    handy if you want to extend later.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "users select own profile" on public.profiles;
create policy "users select own profile"
  on public.profiles for select using (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id);
