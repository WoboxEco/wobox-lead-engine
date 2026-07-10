-- Trae nativamente el pipeline de deals que hoy vive solo en HubSpot (Sin contacto ->
-- Contacto -> Presentacion enviada -> Negociacion -> Onboarding -> Cierre ganado/perdido).
-- HubSpot Pro no se renueva; esto reemplaza sync-hubspot como fuente de verdad del deal stage.
--
-- Namespaced con prefijo deal_ para no chocar con 'contacted' (prospecting) que ya existe.
-- ADD VALUE IF NOT EXISTS es seguro dentro de una transaccion desde PG12+; no se usan los
-- valores nuevos en este mismo archivo (solo se agregan), asi que no hay problema de
-- "unsafe use of new value" dentro de la misma migration.

alter type stage add value if not exists 'deal_sin_contacto';
alter type stage add value if not exists 'deal_contacto';
alter type stage add value if not exists 'deal_presentacion';
alter type stage add value if not exists 'deal_negociacion';
alter type stage add value if not exists 'deal_onboarding';
alter type stage add value if not exists 'deal_ganado';
alter type stage add value if not exists 'deal_perdido';

-- 'note' para logs manuales (comentarios de sales) y 'status_change' para el historial
-- automatico de cambios de stage. 'internal' en channel para interacciones sin canal real.
alter type interaction_type add value if not exists 'note';
alter type interaction_type add value if not exists 'status_change';
alter type channel add value if not exists 'internal';

-- 'hubspot' como source explicito para la migracion (antes se pisaba con 'manual').
alter type source add value if not exists 'hubspot';

alter table companies add column if not exists deal_value numeric;
alter table companies add column if not exists lost_reason text;
alter table companies add column if not exists stage_entered_at timestamptz not null default now();

-- =========================================
-- tasks — seguimientos manuales del sales team (no existia, HubSpot lo cubria)
-- =========================================
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  title text not null,
  due_date date,
  owner uuid references auth.users(id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  check (company_id is not null or contact_id is not null)
);

create index if not exists idx_tasks_company on tasks(company_id);
create index if not exists idx_tasks_due on tasks(due_date) where done = false;

alter table tasks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'tasks' and policyname = 'authenticated_all'
  ) then
    create policy authenticated_all on tasks for all to authenticated using (true) with check (true);
  end if;
end $$;
