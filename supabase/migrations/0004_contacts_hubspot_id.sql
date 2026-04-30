-- Agrega hubspot_id a contacts para dedup en bulk import desde HubSpot.
-- companies.hubspot_id ya existia; ahora dejamos contacts simetrico.

alter table contacts add column if not exists hubspot_id text;

create unique index if not exists idx_contacts_hubspot_id
  on contacts(hubspot_id)
  where hubspot_id is not null;
