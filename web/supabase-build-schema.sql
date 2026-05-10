-- ===========================================================================
-- Tekaida Build — additional schema for the cinematic SaaS workspace.
-- Run AFTER supabase-schema.sql. Idempotent.
--
-- Tables added:
--   projects          -- a creative project (folder of generations)
--   project_members   -- multi-tenant: invited collaborators / clients
--   render_jobs       -- the actual queue rows (queued/processing/done/error)
--   credits           -- per-user balance summary (denormalized; rebuilt by trigger)
--   credit_ledger     -- append-only debit/credit log; balance = sum(amount)
--   api_keys          -- programmatic access tokens (stored as sha256 hashes)
--   profiles_admin    -- admin allow-list (no public registration)
--
-- Conventions:
--   - All user-facing tables have RLS on; "users see own rows" is the default.
--   - Service-role-only writes (queue worker, billing webhook) bypass RLS.
--   - Money/credits are integers (1 credit = $0.01 floor; 1 second of SeaDance
--     ≈ 5 credits — tunable in lib/credits.ts).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. projects + project_members
--
-- Both tables are created BEFORE any policies, because the projects RLS
-- policy references project_members and vice-versa. Splitting "create
-- table" from "create policy" lets the file run top-to-bottom without
-- forward-reference errors (42P01 on a clean install).
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  cover_url   text,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects (owner_id, updated_at desc);

create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','editor','viewer','client')) default 'editor',
  invited_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

-- Now both tables exist; safe to attach the cross-referencing policies.
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

drop policy if exists "members read project" on public.projects;
create policy "members read project"
  on public.projects for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.project_members m
      where m.project_id = projects.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "owner mutate project" on public.projects;
create policy "owner mutate project"
  on public.projects for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "members read membership" on public.project_members;
create policy "members read membership"
  on public.project_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = project_members.project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "owner mutate membership" on public.project_members;
create policy "owner mutate membership"
  on public.project_members for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_members.project_id and p.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. render_jobs  (queue rows — one per render request)
-- ---------------------------------------------------------------------------

create table if not exists public.render_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  status       text not null check (status in ('queued','processing','done','error','canceled')) default 'queued',
  provider     text not null default 'seedance',
  prompt       text not null,
  params       jsonb not null default '{}'::jsonb,
  output_url   text,
  thumbnail_url text,
  duration     int,
  credits_cost int not null default 0,
  error        text,
  progress     int not null default 0,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists render_jobs_user_idx on public.render_jobs (user_id, created_at desc);
create index if not exists render_jobs_project_idx on public.render_jobs (project_id, created_at desc);
create index if not exists render_jobs_status_idx on public.render_jobs (status, created_at);

alter table public.render_jobs enable row level security;

drop policy if exists "users read own jobs" on public.render_jobs;
create policy "users read own jobs"
  on public.render_jobs for select
  using (
    auth.uid() = user_id
    or (
      project_id is not null
      and exists (
        select 1 from public.project_members m
        where m.project_id = render_jobs.project_id and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists "users insert own jobs" on public.render_jobs;
create policy "users insert own jobs"
  on public.render_jobs for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own jobs" on public.render_jobs;
create policy "users update own jobs"
  on public.render_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. credit_ledger + credits balance
-- ---------------------------------------------------------------------------

create table if not exists public.credit_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount       int not null,                                    -- positive = top-up, negative = spend
  reason       text not null,                                   -- 'signup_bonus','stripe_topup','render_job','refund','admin_grant'
  ref_id       uuid,                                            -- internal foreign key (e.g. render_jobs.id)
  external_ref text unique,                                     -- external idempotency key (e.g. stripe checkout session id)
  created_at   timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;

drop policy if exists "users read own ledger" on public.credit_ledger;
create policy "users read own ledger"
  on public.credit_ledger for select
  using (auth.uid() = user_id);

-- Balance summary (for fast reads — kept in sync by trigger below)
create table if not exists public.credits (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  balance     int not null default 0,
  lifetime_topup int not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.credits enable row level security;

drop policy if exists "users read own balance" on public.credits;
create policy "users read own balance"
  on public.credits for select
  using (auth.uid() = user_id);

-- Recompute balance whenever a ledger row is inserted (single source of truth).
create or replace function public.recompute_credit_balance()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.credits (user_id, balance, lifetime_topup, updated_at)
  values (
    new.user_id,
    coalesce((select sum(amount) from public.credit_ledger where user_id = new.user_id), 0),
    coalesce((select sum(amount) from public.credit_ledger where user_id = new.user_id and amount > 0), 0),
    now()
  )
  on conflict (user_id) do update
  set balance        = excluded.balance,
      lifetime_topup = excluded.lifetime_topup,
      updated_at     = now();
  return new;
end;
$$;

drop trigger if exists trg_credit_ledger_balance on public.credit_ledger;
create trigger trg_credit_ledger_balance
  after insert on public.credit_ledger
  for each row execute function public.recompute_credit_balance();

-- New users get a signup bonus (500 credits ≈ a 30-second test render).
-- Fires once per auth.users row.
create or replace function public.grant_signup_bonus()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.credit_ledger (user_id, amount, reason)
  values (new.id, 500, 'signup_bonus');
  return new;
end;
$$;

drop trigger if exists trg_signup_bonus on auth.users;
create trigger trg_signup_bonus
  after insert on auth.users
  for each row execute function public.grant_signup_bonus();

-- ---------------------------------------------------------------------------
-- 5. api_keys  (programmatic access tokens — stored as sha256 hashes)
-- ---------------------------------------------------------------------------

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  key_hash    text not null unique,        -- sha256 of the plaintext token
  prefix      text not null,                -- first 12 chars, shown in UI
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists api_keys_user_idx on public.api_keys (user_id, created_at desc);

alter table public.api_keys enable row level security;

drop policy if exists "users manage own api keys" on public.api_keys;
create policy "users manage own api keys"
  on public.api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. admin allow-list  (no public mutation; managed by service role)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles_admin (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  granted_at  timestamptz not null default now()
);

alter table public.profiles_admin enable row level security;

-- (No SELECT policy — only the service role reads this. We expose admin
--  status through a SECURITY DEFINER function below so the UI can flip
--  the admin nav item without leaking the table.)

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from public.profiles_admin where user_id = uid);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. atomic credit debit  (eliminates the read-balance / insert-debit race)
-- ---------------------------------------------------------------------------
--
-- Wraps the balance check, ledger insert, and refusal in a single transaction
-- with a row-level lock on public.credits. Two concurrent submit calls for
-- the same user serialize on the SELECT FOR UPDATE: the second only sees the
-- first's debit applied, so it correctly fails with insufficient_credits if
-- there isn't enough balance left.
--
-- Returns the new balance on success. Raises sqlstate 'P0001' with a message
-- starting "insufficient_credits:" when the debit can't proceed.
create or replace function public.debit_credits(
  p_user_id  uuid,
  p_amount   int,
  p_reason   text,
  p_ref_id   uuid default null
)
returns int
language plpgsql
security definer
as $$
declare
  v_balance int;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  -- Lock the user's balance row for the duration of this transaction. If no
  -- row exists yet, treat the balance as zero.
  select balance into v_balance
  from public.credits
  where user_id = p_user_id
  for update;

  v_balance := coalesce(v_balance, 0);

  if v_balance < p_amount then
    raise exception 'insufficient_credits: need % have %', p_amount, v_balance
      using errcode = 'P0001';
  end if;

  insert into public.credit_ledger (user_id, amount, reason, ref_id)
  values (p_user_id, -p_amount, p_reason, p_ref_id);

  -- The trigger on credit_ledger updates the credits row. Return the new
  -- balance; we re-read because the trigger uses sum() and we want truth.
  select balance into v_balance from public.credits where user_id = p_user_id;
  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.debit_credits(uuid, int, text, uuid) from public;
grant execute on function public.debit_credits(uuid, int, text, uuid) to authenticated, service_role;
