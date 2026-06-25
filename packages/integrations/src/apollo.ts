import { type Venture, createAdminClient, env } from '@wobox/core';
import pRetry from 'p-retry';

export interface ApolloAccount {
  id: string;
  name: string;
  website_url?: string | null;
  linkedin_url?: string | null;
  primary_domain?: string | null;
}

export interface ApolloOrganization {
  id: string;
  name: string;
  website_url?: string | null;
  linkedin_url?: string | null;
  primary_domain?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface SearchOrganizationsParams {
  /**
   * Industry keyword tags. Se mapea a `q_organization_keyword_tags` (text matching).
   * Apollo NO acepta nombres de industria via `q_organization_industries` — ese campo
   * no existe en la API. Para precision real hay que usar `industryTagIds`.
   */
  industries?: string[];
  excludeIndustries?: string[];
  /**
   * IDs internos de Apollo (ej "5567cdb27369644d39040000"). Mas preciso que keyword tags.
   * Si se pasan, anula `industries` (Apollo aplica este filtro como hard match).
   */
  industryTagIds?: string[];
  locations?: string[];
  employeeRanges?: string[]; // e.g. ["11,50", "51,200"]
  /** General text query (matches name, description, etc.) */
  keywords?: string;
  page?: number;
  perPage?: number;
}

export interface SearchOrganizationsResult {
  organizations: ApolloOrganization[];
  page: number;
  totalPages: number;
  totalEntries: number;
}

export async function searchOrganizations(
  params: SearchOrganizationsParams,
): Promise<SearchOrganizationsResult> {
  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    per_page: params.perPage ?? 25,
  };

  // Filtro de industria: tag IDs son hard match, keyword tags son text-match (mas laxo).
  // Si hay tag IDs, usamos solo eso. Si no, mandamos keyword tags.
  if (params.industryTagIds?.length) {
    body.organization_industry_tag_ids = params.industryTagIds;
  } else if (params.industries?.length) {
    body.q_organization_keyword_tags = params.industries;
  }
  if (params.excludeIndustries?.length) {
    body.not_q_organization_keyword_tags = params.excludeIndustries;
  }
  if (params.locations?.length) body.organization_locations = params.locations;
  if (params.employeeRanges?.length) {
    body.organization_num_employees_ranges = params.employeeRanges;
  }
  if (params.keywords) body.q_keywords = params.keywords;

  const res = await apolloFetch<{
    organizations?: ApolloOrganization[];
    accounts?: ApolloOrganization[];
    pagination?: { page?: number; total_pages?: number; total_entries?: number };
  }>('/mixed_companies/search', body);

  // Apollo a veces devuelve `accounts` en lugar de `organizations` segun el plan/endpoint.
  const organizations = res.organizations ?? res.accounts ?? [];

  return {
    organizations,
    page: res.pagination?.page ?? params.page ?? 1,
    totalPages: res.pagination?.total_pages ?? 1,
    totalEntries: res.pagination?.total_entries ?? organizations.length,
  };
}

export interface ApolloContact {
  id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  organization_name?: string | null;
  owner_id?: string | null;
  person_id?: string | null;
}

export interface ApolloPersonTeaser {
  id: string;
  first_name: string;
  last_name_obfuscated?: string;
  title?: string | null;
  has_email: boolean;
  organization?: { name?: string | null } | null;
}

export interface ApolloPersonFull {
  id: string;
  first_name: string;
  last_name?: string;
  name: string;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  organization?: { id?: string; name?: string; primary_domain?: string } | null;
}

export async function searchAccount(domain: string): Promise<ApolloAccount | null> {
  const clean = normalizeDomain(domain);
  if (!clean) return null;
  const res = await apolloFetch<{ accounts: ApolloAccount[] }>('/accounts/search', {
    q_organization_domains_list: [clean],
    page: 1,
    per_page: 5,
  });
  const match = res.accounts.find(
    (a) => a.primary_domain === clean || (a.website_url ?? '').includes(clean),
  );
  return match ?? res.accounts[0] ?? null;
}

export async function findWarmConnections(orgId: string): Promise<ApolloContact[]> {
  const res = await apolloFetch<{ contacts: ApolloContact[] }>('/contacts/search', {
    q_organization_ids: [orgId],
    page: 1,
    per_page: 25,
  });
  return res.contacts ?? [];
}

export interface SearchDecisionMakersParams {
  orgId: string;
  titles?: string[];
  perPage?: number;
}

export async function searchDecisionMakers(
  params: SearchDecisionMakersParams,
): Promise<ApolloPersonTeaser[]> {
  const titles = params.titles ?? ['CEO', 'Founder', 'Owner', 'Co-Founder', 'Managing Director'];
  const res = await apolloFetch<{ people: ApolloPersonTeaser[] }>('/mixed_people/api_search', {
    organization_ids: [params.orgId],
    person_titles: titles,
    page: 1,
    per_page: params.perPage ?? 10,
  });
  return res.people ?? [];
}

export interface MatchPersonParams {
  personId?: string;
  email?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  revealPersonalEmails?: boolean;
  venture?: Venture;
  operation?: string;
}

export async function matchPerson(params: MatchPersonParams): Promise<ApolloPersonFull | null> {
  const body: Record<string, unknown> = {
    reveal_personal_emails: params.revealPersonalEmails ?? false,
  };
  if (params.personId) body.id = params.personId;
  if (params.email) body.email = params.email;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;
  if (params.firstName) body.first_name = params.firstName;
  if (params.lastName) body.last_name = params.lastName;
  if (params.organizationName) body.organization_name = params.organizationName;

  // Sin reintentos para uso interactivo (evita timeouts en Vercel hobby)
  const res = await apolloFetch<{ person: ApolloPersonFull | null }>('/people/match', body, 0);

  await trackUsage({
    operation: params.operation ?? 'people.match',
    credits: 1,
    ...(params.venture ? { venture: params.venture } : {}),
  });

  return res.person ?? null;
}

async function trackUsage(p: {
  operation: string;
  credits: number;
  venture?: Venture;
}): Promise<void> {
  try {
    const db = createAdminClient();
    await db.from('api_usage').insert({
      service: 'apollo',
      operation: p.operation,
      credits_used: p.credits,
      tokens_used: 0,
      venture: p.venture ?? null,
    });
  } catch {
    // tracking no debe romper la skill
  }
}

function normalizeDomain(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  return (base.split('/')[0] ?? '').split('?')[0] ?? '';
}

async function apolloFetch<T>(path: string, body: unknown, retries = 3): Promise<T> {
  const e = env();
  if (!e.APOLLO_API_KEY) {
    throw new Error('APOLLO_API_KEY not configured');
  }
  return pRetry(
    async () => {
      const res = await fetch(`${e.APOLLO_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
          'X-Api-Key': e.APOLLO_API_KEY ?? '',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Apollo ${path} ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    },
    { retries, minTimeout: 1000, factor: 2 },
  );
}

// @deprecated — uso legacy. Preferir apolloFetch + funciones tipadas.
export async function _apolloFetch<T>(path: string, body: unknown): Promise<T> {
  return apolloFetch<T>(path, body);
}
