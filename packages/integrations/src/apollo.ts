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
  /** ID del tag de industria de Apollo (sirve para aprender el mapeo nombre → ID). */
  industry_tag_id?: string | null;
  /** Keywords libres que Apollo asocia a la org. */
  keywords?: string[] | null;
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
  rememberIndustryTags(organizations);

  return {
    organizations,
    page: res.pagination?.page ?? params.page ?? 1,
    totalPages: res.pagination?.total_pages ?? 1,
    totalEntries: res.pagination?.total_entries ?? organizations.length,
  };
}

// ---------------------------------------------------------------------------------------
// Industry tag IDs (filtro duro `organization_industry_tag_ids`)
//
// Apollo identifica cada industria (taxonomía de LinkedIn, ej "apparel & fashion") con un ID
// interno tipo "5567cd...". No hay un endpoint público documentado para listarlas, así que:
//   1. `KNOWN_INDUSTRY_TAG_IDS`: IDs verificados hardcodeados (vacío hasta confirmar contra la
//      cuenta; cuando se resuelven se loguean con `resolved` para copiarlos acá).
//   2. Lookup en `POST /tags/search` (`kind: linkedin_industry`): el endpoint que usa la app web
//      de Apollo. Sin reintentos y con timeout corto; si falla, esa industria queda sin resolver.
//   3. Aprendizaje pasivo: cada org que devuelve `searchOrganizations` trae `industry` +
//      `industry_tag_id`, y se guarda en el cache.
// Cache en memoria del proceso (en Vercel dura lo que vive la instancia caliente).
// ---------------------------------------------------------------------------------------

/** Nombre de industria normalizado (minúsculas, "&" → "and", espacios simples). */
export function normalizeIndustryName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** IDs verificados (nombre normalizado → tag ID). Completar con los que loguea el lookup. */
export const KNOWN_INDUSTRY_TAG_IDS: Readonly<Record<string, string>> = {};

/** nombre normalizado → tag ID (o null = lookup ya falló en este proceso). */
const industryTagCache = new Map<string, string | null>(Object.entries(KNOWN_INDUSTRY_TAG_IDS));

const TAG_LOOKUP_TIMEOUT_MS = 2_500;

function rememberIndustryTags(orgs: ApolloOrganization[]): void {
  for (const o of orgs) {
    if (!o.industry || !o.industry_tag_id) continue;
    const key = normalizeIndustryName(o.industry);
    if (!industryTagCache.get(key)) industryTagCache.set(key, o.industry_tag_id);
  }
}

export interface ResolveIndustryTagIdsResult {
  ids: string[];
  /** nombre → ID de lo resuelto (para loguear y hardcodear). */
  resolved: Record<string, string>;
  missing: string[];
}

/** Resuelve nombres de industria a tag IDs de Apollo (cache → lookup). Nunca tira. */
export async function resolveIndustryTagIds(names: string[]): Promise<ResolveIndustryTagIdsResult> {
  const keys = [...new Set(names.map(normalizeIndustryName).filter(Boolean))];
  await Promise.all(
    keys
      .filter((k) => !industryTagCache.has(k))
      .map(async (k) => {
        industryTagCache.set(k, await lookupIndustryTag(k));
      }),
  );
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const k of keys) {
    const id = industryTagCache.get(k);
    if (id) resolved[k] = id;
    else missing.push(k);
  }
  return { ids: [...new Set(Object.values(resolved))], resolved, missing };
}

async function lookupIndustryTag(key: string): Promise<string | null> {
  try {
    const res = await apolloFetch<{
      tags?: Array<{ id?: string; _id?: string; cleaned_name?: string; name?: string }>;
    }>(
      '/tags/search',
      { q_tag_fuzzy_name: key, kind: 'linkedin_industry', display_mode: 'fuzzy_select_mode' },
      0,
      TAG_LOOKUP_TIMEOUT_MS,
    );
    const match = (res.tags ?? []).find(
      (t) => normalizeIndustryName(t.cleaned_name ?? t.name ?? '') === key,
    );
    return match?.id ?? match?._id ?? null;
  } catch {
    return null;
  }
}

/** Solo tests. */
export function _resetIndustryTagCache(): void {
  industryTagCache.clear();
  for (const [k, v] of Object.entries(KNOWN_INDUSTRY_TAG_IDS)) industryTagCache.set(k, v);
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
  // Sin reintentos para uso interactivo
  const res = await apolloFetch<{ people: ApolloPersonTeaser[] }>(
    '/mixed_people/api_search',
    {
      organization_ids: [params.orgId],
      person_titles: titles,
      page: 1,
      per_page: params.perPage ?? 10,
    },
    0,
  );
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

async function apolloFetch<T>(
  path: string,
  body: unknown,
  retries = 3,
  timeoutMs?: number,
): Promise<T> {
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
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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
