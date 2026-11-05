-- Cursor de paginación por (venture, filtros) para search-leads (Apollo).
-- Sin esto cada +Prospect pedía siempre la página 1 con los mismos filtros → mismas orgs
-- → el dedup las descartaba todas y se gastaba 1 crédito por corrida sin insertar nada.
create table if not exists sourcing_cursors (
  id uuid primary key default gen_random_uuid(),
  venture venture not null,
  filters_hash text not null,
  filters jsonb,
  next_page int not null default 1,
  total_pages int,
  updated_at timestamptz default now(),
  unique (venture, filters_hash)
);

-- Solo lo usa el service role (skills / API routes). RLS activo sin policies = sin acceso anon.
alter table sourcing_cursors enable row level security;
