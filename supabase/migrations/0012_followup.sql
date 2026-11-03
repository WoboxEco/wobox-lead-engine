-- Fase 3 outbound: follow-up automatico + deteccion/clasificacion de respuestas.
--
-- companies.sequence_paused   la secuencia nurture no genera ni envia mas pasos
-- companies.paused_reason     por que se pauso (ej: 'replied')
-- companies.sequence_resume_at  si esta seteado y es futuro, nurture espera hasta esa fecha
--                               (lo usa out_of_office para reprogramar)
-- campaigns.auto_send         el cron diario envia solo los follow-ups de email (steps 2-4)
-- replies                     respuestas entrantes (hoy: email via IMAP)

alter table companies add column if not exists sequence_paused boolean not null default false;
alter table companies add column if not exists paused_reason text;
alter table companies add column if not exists sequence_resume_at timestamptz;

alter table campaigns add column if not exists auto_send boolean not null default false;

create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  channel channel not null default 'email',
  -- Message-ID del email entrante (dedup: el IMAP no marca como leido).
  external_id text,
  from_email text,
  subject text,
  body text,
  received_at timestamptz not null default now(),
  intent text check (
    intent in ('interested', 'not_now', 'not_interested', 'question', 'out_of_office', 'other')
  ),
  suggested_action text,
  ai_reasoning text,
  classified_at timestamptz,
  handled boolean not null default false,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_replies_external_id
  on replies(external_id) where external_id is not null;
create index if not exists idx_replies_unhandled on replies(received_at desc) where handled = false;
create index if not exists idx_replies_company on replies(company_id);

alter table replies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'replies' and policyname = 'authenticated_all'
  ) then
    create policy authenticated_all on replies for all to authenticated using (true) with check (true);
  end if;
end $$;

-- La reactivacion semanal tambien despausa la secuencia (ej: "Nurture 3 meses" desde /inbox).
-- cron.schedule con el mismo nombre reemplaza el job existente.
select cron.schedule(
  'reactivate-discarded',
  '0 9 * * 1',
  $$
  update companies
  set stage = 'new', reactivation_date = null,
      sequence_paused = false, paused_reason = null, sequence_resume_at = null,
      updated_at = now()
  where stage = 'discarded' and reactivation_date <= now();
  $$
);
