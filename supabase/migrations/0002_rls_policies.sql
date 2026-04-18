-- RLS: los 3 founders (usuarios autenticados) tienen acceso total.
-- No hay multi-tenant, no hay granularidad fina. Mantener simple.

alter table companies enable row level security;
alter table contacts enable row level security;
alter table scores enable row level security;
alter table interactions enable row level security;
alter table messages enable row level security;
alter table campaigns enable row level security;
alter table error_logs enable row level security;
alter table api_usage enable row level security;

-- Policy: authenticated = full access
do $$
declare t text;
begin
  foreach t in array array['companies','contacts','scores','interactions','messages','campaigns','error_logs','api_usage']
  loop
    execute format('create policy authenticated_all on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
