-- pg_cron jobs: nurture scheduler diario + reactivation semanal.
-- Requiere extension pg_cron habilitada en el dashboard de Supabase.

create extension if not exists pg_cron;

-- Vista que alimenta el dashboard "hoy te toca" por founder.
-- Un lead en stage 'nurturing' genera touchpoints segun su sequence_step.
create or replace view nurture_today as
select
  m.id as message_id,
  m.company_id,
  m.contact_id,
  m.sequence_step,
  m.approach_type,
  m.channel,
  c.assigned_to,
  c.name as company_name,
  c.venture,
  c.buyer_persona,
  m.status
from messages m
join companies c on c.id = m.company_id
where m.status = 'draft'
  and c.stage in ('nurturing', 'qualified')
  and (m.created_at::date = current_date or m.sequence_step <= 4);

-- Cron 1: reactivacion semanal (lunes 6am ART = 9am UTC)
select cron.schedule(
  'reactivate-discarded',
  '0 9 * * 1',
  $$
  update companies
  set stage = 'new', reactivation_date = null, updated_at = now()
  where stage = 'discarded' and reactivation_date <= now();
  $$
);

-- Cron 2: cerrar companies sin progreso (60 dias en contacted sin respuesta)
select cron.schedule(
  'stale-contacted',
  '0 10 * * *',
  $$
  update companies
  set stage = 'discarded', reactivation_date = now() + interval '6 months', updated_at = now()
  where stage = 'contacted'
    and updated_at < now() - interval '60 days'
    and not exists (
      select 1 from interactions i
      where i.company_id = companies.id
        and i.outcome in ('replied', 'accepted', 'meeting_booked')
    );
  $$
);
