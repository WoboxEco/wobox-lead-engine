-- Canales de contacto a nivel company (scrape del website + Google Maps).
-- enriched_at: enriquecimiento de canales terminado (hay telefono o ya se intento Maps).
alter table companies add column if not exists phone text;
alter table companies add column if not exists whatsapp text;
alter table companies add column if not exists generic_email text;
alter table companies add column if not exists enriched_at timestamptz;

create index if not exists idx_companies_enriched_at_pending
  on companies(venture, created_at desc) where enriched_at is null;
