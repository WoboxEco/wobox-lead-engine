-- Wobox Lead Engine — Schema inicial
-- Multi-venture (wobox_food, wobox_fashion, loop) + dual pipeline (prospeccion + ventas).

-- =========================================
-- ENUMS
-- =========================================
create type venture as enum ('wobox_food', 'wobox_fashion', 'loop');
create type vertical as enum ('food', 'fashion', 'other');
create type stage as enum ('new', 'enriched', 'qualified', 'nurturing', 'contacted', 'meeting_booked', 'discarded');
create type source as enum ('apollo', 'web_search', 'csv', 'manual');
create type franchise_type as enum ('centralized', 'decentralized', 'not_franchise');
create type buyer_persona as enum ('BP1', 'BP2', 'BP3', 'BP4', 'BP5', 'BP6');
create type warm_path_type as enum ('direct', '2nd_degree', 'none');
create type level_tier as enum ('high', 'mid', 'low');
create type social_source as enum ('instagram', 'linkedin', 'manual', 'pending');
create type interaction_type as enum ('like', 'comment', 'resource_sent', 'connection_request', 'message', 'email', 'call', 'meeting', 'reactivation');
create type channel as enum ('linkedin', 'email', 'whatsapp', 'phone', 'in_person', 'instagram_dm', 'calendly');
create type outcome as enum ('pending', 'sent', 'opened', 'replied', 'accepted', 'declined', 'meeting_booked', 'no_response');
create type approach_type as enum ('warm_intro', 'nurture', 'direct');
create type message_status as enum ('draft', 'approved', 'sent', 'discarded');
create type campaign_status as enum ('active', 'paused', 'completed');
create type api_service as enum ('apollo', 'claude', 'apify', 'instagram', 'google', 'hubspot');

-- =========================================
-- companies
-- =========================================
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venture venture not null,
  vertical vertical,
  subsector text,
  buyer_persona buyer_persona,
  locations_count int,
  is_franchise boolean default false,
  franchise_type franchise_type,
  region text,
  neighborhood text,
  social_followers int,
  social_source social_source default 'pending',
  instagram_handle text,
  overstock_likelihood level_tier,
  recurrence_potential level_tier,
  digital_readiness level_tier,
  website text,
  website_normalized text generated always as (
    lower(regexp_replace(coalesce(website, ''), '^https?://(www\.)?|/$', '', 'g'))
  ) stored,
  linkedin_url text,
  apollo_id text,
  hubspot_id text,
  hubspot_deal_id text,
  stage stage not null default 'new',
  source source not null default 'manual',
  assigned_to uuid references auth.users(id) on delete set null,
  campaign_id uuid,
  reactivation_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_companies_venture_stage on companies(venture, stage);
create unique index idx_companies_linkedin on companies(linkedin_url) where linkedin_url is not null;
create unique index idx_companies_website on companies(website_normalized) where website_normalized is not null and website_normalized <> '';
create unique index idx_companies_instagram on companies(instagram_handle, venture) where instagram_handle is not null;
create index idx_companies_assigned on companies(assigned_to);
create index idx_companies_reactivation on companies(reactivation_date) where reactivation_date is not null;

-- =========================================
-- campaigns
-- =========================================
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venture venture not null,
  vertical_focus text,
  region_focus text,
  approach_strategy text,
  status campaign_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

alter table companies add constraint companies_campaign_fk foreign key (campaign_id) references campaigns(id) on delete set null;
create index idx_companies_campaign on companies(campaign_id) where campaign_id is not null;

-- =========================================
-- contacts
-- =========================================
create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  role text,
  email text,
  linkedin_url text,
  instagram_url text,
  phone text,
  warm_path warm_path_type default 'none',
  warm_connector text,
  is_decision_maker boolean default false,
  contact_source text,
  created_at timestamptz not null default now()
);

create index idx_contacts_company on contacts(company_id);
create index idx_contacts_email on contacts(lower(email)) where email is not null;

-- =========================================
-- scores (JSONB dimensions — flexible entre modelos wobox/loop)
-- =========================================
create table scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  total_score int not null check (total_score between 1 and 100),
  scoring_model text not null,
  dimensions jsonb not null default '{}'::jsonb,
  ai_reasoning text,
  buyer_persona_assigned text,
  scored_at timestamptz not null default now()
);

create index idx_scores_company on scores(company_id, scored_at desc);
create index idx_scores_total on scores(total_score desc);

-- =========================================
-- interactions
-- =========================================
create table interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete set null,
  company_id uuid not null references companies(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  type interaction_type not null,
  channel channel not null,
  content text,
  ai_generated boolean default false,
  outcome outcome not null default 'pending',
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now()
);

create index idx_interactions_company on interactions(company_id, performed_at desc);
create index idx_interactions_contact on interactions(contact_id);

-- =========================================
-- messages
-- =========================================
create table messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  sequence_step int,
  approach_type approach_type not null,
  channel channel not null,
  subject text,
  body text not null,
  original_body text not null,
  prompt_version text not null,
  status message_status not null default 'draft',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index idx_messages_contact_step on messages(contact_id, sequence_step);
create index idx_messages_status on messages(status);
create index idx_messages_campaign on messages(campaign_id) where campaign_id is not null;

-- =========================================
-- error_logs
-- =========================================
create table error_logs (
  id uuid primary key default gen_random_uuid(),
  skill text not null,
  company_id uuid references companies(id) on delete set null,
  error_type text,
  error_message text,
  context jsonb default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_error_logs_unresolved on error_logs(created_at desc) where resolved = false;

-- =========================================
-- api_usage
-- =========================================
create table api_usage (
  id uuid primary key default gen_random_uuid(),
  service api_service not null,
  operation text not null,
  credits_used int default 0,
  tokens_used int,
  venture venture,
  created_at timestamptz not null default now()
);

create index idx_api_usage_service_time on api_usage(service, created_at desc);
create index idx_api_usage_venture on api_usage(venture, created_at desc) where venture is not null;

-- =========================================
-- updated_at trigger
-- =========================================
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();
