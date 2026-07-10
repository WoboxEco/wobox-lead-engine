-- Ownership: companies.assigned_to ya existia (uuid -> auth.users) pero no se
-- mostraba en ningun lado con nombre legible. Se agrega:
--   1. company_co_owners: compartir un lead entre varios sales reps.
--   2. ownership_handoffs: programar un cambio de owner a futuro (vacaciones,
--      renuncias) sin perder quien lo tenia antes.

create table if not exists company_co_owners (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists ownership_handoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  from_user_id uuid references auth.users(id) on delete set null,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  effective_date date not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists idx_handoffs_company on ownership_handoffs(company_id);
create index if not exists idx_handoffs_pending on ownership_handoffs(effective_date) where applied_at is null;

alter table company_co_owners enable row level security;
alter table ownership_handoffs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'company_co_owners' and policyname = 'authenticated_all'
  ) then
    create policy authenticated_all on company_co_owners for all to authenticated using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'ownership_handoffs' and policyname = 'authenticated_all'
  ) then
    create policy authenticated_all on ownership_handoffs for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Cron diario: aplica cualquier handoff cuya effective_date ya llego. Mismo horario
-- que el cron de stale-contacted (10am UTC) para no pisar otros jobs. Confirmado
-- explicitamente con el usuario (auto-apply via pg_cron, no manual).
select cron.schedule(
  'apply-ownership-handoffs',
  '0 10 * * *',
  $$
  update companies c
  set assigned_to = h.to_user_id, updated_at = now()
  from ownership_handoffs h
  where h.company_id = c.id
    and h.applied_at is null
    and h.effective_date <= current_date;

  update ownership_handoffs
  set applied_at = now()
  where applied_at is null and effective_date <= current_date;
  $$
);
