import { type DbClient, createAdminClient, createLogger, writeErrorLog } from '@wobox/core';
import { apollo } from '@wobox/integrations';

// Default: Haiku. Mantenido por parity con otras skills aunque hoy no se usa Claude aca.
export const DEFAULT_MODEL = 'haiku';

export type SearchLeadsVenture = 'wobox_food' | 'wobox_fashion' | 'loop';

export interface SearchLeadsOptions {
  venture?: string;
  industries?: string;
  employeeRanges?: string;
  excludeIndustries?: string;
  region?: string;
  keywords?: string;
  campaign?: string;
  limit?: string;
  model?: string;
}

// Titulos que tratamos como decision makers para la busqueda inicial.
const DECISION_MAKER_TITLES = [
  'CEO',
  'Founder',
  'Owner',
  'Co-Founder',
  'Managing Director',
  'Director Comercial',
  'Gerente Comercial',
  'Head of Sales',
];

// Defaults por venture: ajustables por CLI con flags --industries, --employee-ranges, etc.
const DEFAULTS_BY_VENTURE: Record<
  SearchLeadsVenture,
  {
    industries: string[];
    employeeRanges: string[];
    locations: string[];
    excludeIndustries: string[];
  }
> = {
  wobox_food: {
    industries: ['food & beverages', 'food production', 'restaurants'],
    employeeRanges: ['11,50', '51,200', '201,500'],
    locations: ['Argentina'],
    excludeIndustries: [
      'financial services',
      'management consulting',
      'legal services',
      'marketing and advertising',
      'information technology and services',
    ],
  },
  wobox_fashion: {
    industries: ['apparel & fashion', 'retail', 'consumer goods'],
    employeeRanges: ['11,50', '51,200'],
    locations: ['Argentina'],
    excludeIndustries: [
      'financial services',
      'management consulting',
      'legal services',
      'marketing and advertising',
      'information technology and services',
    ],
  },
  loop: {
    industries: ['restaurants', 'health, wellness and fitness', 'retail', 'apparel & fashion'],
    employeeRanges: ['51,200', '201,500'],
    locations: ['Argentina'],
    excludeIndustries: [
      'financial services',
      'management consulting',
      'legal services',
      'marketing and advertising',
      'information technology and services',
    ],
  },
};

export async function run(opts: SearchLeadsOptions): Promise<void> {
  const log = createLogger('search-leads');
  const db = createAdminClient();

  if (!opts.venture) {
    throw new Error('search-leads: --venture es requerido (wobox_food | wobox_fashion | loop)');
  }
  const venture = opts.venture as SearchLeadsVenture;
  if (!(venture in DEFAULTS_BY_VENTURE)) {
    throw new Error(
      `search-leads: venture invalida "${opts.venture}". Esperado: wobox_food | wobox_fashion | loop`,
    );
  }

  const defaults = DEFAULTS_BY_VENTURE[venture];

  // CSV simple para industries / exclude / locations; ; para employeeRanges (los valores ya tienen ,).
  const industries = parseCsv(opts.industries) ?? defaults.industries;
  const employeeRanges = parseSemicolonList(opts.employeeRanges) ?? defaults.employeeRanges;
  const excludeIndustries = parseCsv(opts.excludeIndustries) ?? defaults.excludeIndustries;
  const locations = opts.region ? [opts.region] : defaults.locations;

  const perPage = opts.limit ? Number.parseInt(opts.limit, 10) : 25;

  log.info(
    { venture, industries, employeeRanges, excludeIndustries, locations, perPage },
    'apollo searchOrganizations',
  );

  let result: apollo.SearchOrganizationsResult;
  try {
    result = await apollo.searchOrganizations({
      industries,
      excludeIndustries,
      locations,
      employeeRanges,
      ...(opts.keywords ? { keywords: opts.keywords } : {}),
      perPage,
    });
  } catch (err) {
    log.error({ err }, 'apollo searchOrganizations failed');
    await writeErrorLog(db, {
      skill: 'search-leads',
      error: err,
      context: { venture, industries, employeeRanges, excludeIndustries, locations, perPage },
    });
    throw err;
  }

  // Track creditos: 1 por cada call a search-organizations.
  await db.from('api_usage').insert({
    service: 'apollo',
    operation: 'search-organizations',
    credits_used: 1,
    tokens_used: null,
    venture,
  });

  const orgs = result.organizations;
  log.info(
    { returned: orgs.length, totalEntries: result.totalEntries, totalPages: result.totalPages },
    'apollo returned organizations',
  );

  if (orgs.length === 0) {
    console.log(
      `search-leads: no se encontraron orgs para venture=${venture}. Probar otros filtros.`,
    );
    return;
  }

  // Optional campaign upsert.
  let campaignId: string | null = null;
  if (opts.campaign) {
    campaignId = await upsertCampaign(db, opts.campaign, venture, locations[0] ?? null);
  }

  // Dedup contra companies existentes de la misma venture.
  const { data: existing } = await db
    .from('companies')
    .select('name, website_normalized, linkedin_url')
    .eq('venture', venture);

  const seenWebsite = new Set<string>();
  const seenLinkedin = new Set<string>();
  const seenNameVenture = new Set<string>();
  for (const c of (existing as Array<Record<string, unknown>>) ?? []) {
    const wn = (c.website_normalized as string | null) ?? '';
    if (wn) seenWebsite.add(wn);
    const li = (c.linkedin_url as string | null) ?? '';
    if (li) seenLinkedin.add(li.toLowerCase());
    const name = String(c.name ?? '')
      .toLowerCase()
      .trim();
    if (name) seenNameVenture.add(name);
  }

  let inserted = 0;
  let duplicates = 0;
  let contactsAdded = 0;

  for (const org of orgs) {
    const websiteNorm = org.website_url ? normalizeWebsite(org.website_url) : '';
    const linkedinKey = (org.linkedin_url ?? '').toLowerCase();
    const nameKey = (org.name ?? '').toLowerCase().trim();

    const isDup =
      (websiteNorm && seenWebsite.has(websiteNorm)) ||
      (linkedinKey && seenLinkedin.has(linkedinKey)) ||
      (nameKey && seenNameVenture.has(nameKey));

    if (isDup) {
      duplicates += 1;
      continue;
    }

    if (websiteNorm) seenWebsite.add(websiteNorm);
    if (linkedinKey) seenLinkedin.add(linkedinKey);
    if (nameKey) seenNameVenture.add(nameKey);

    const region = buildRegion(org);

    const { data: companyRow, error: insertErr } = await db
      .from('companies')
      .insert({
        name: org.name,
        venture,
        website: org.website_url ?? null,
        linkedin_url: org.linkedin_url ?? null,
        region,
        source: 'apollo',
        stage: 'new',
        apollo_id: org.id,
        campaign_id: campaignId,
      } as never)
      .select('id')
      .single();

    if (insertErr) {
      log.warn({ err: insertErr.message, name: org.name }, 'insert company failed');
      continue;
    }

    inserted += 1;
    const companyId = (companyRow as { id: string } | null)?.id;
    if (!companyId) continue;

    // Decision makers (Apollo teaser, no revelamos email para no quemar creditos).
    try {
      const people = await apollo.searchDecisionMakers({
        orgId: org.id,
        titles: DECISION_MAKER_TITLES,
      });
      if (people.length > 0) {
        const contactRows = people.map((p) => ({
          company_id: companyId,
          name: buildContactName(p),
          role: p.title ?? null,
          contact_source: 'Apollo',
          is_decision_maker: true,
        }));
        const { error: contactErr } = await db.from('contacts').insert(contactRows as never);
        if (contactErr) {
          log.warn({ err: contactErr.message, company: org.name }, 'insert contacts failed');
        } else {
          contactsAdded += contactRows.length;
        }
      }
    } catch (err) {
      // No queremos romper toda la corrida si un org no tiene DMs visibles.
      log.warn({ err: String(err), company: org.name }, 'searchDecisionMakers failed');
    }
  }

  const creditsUsed = 1; // solo contamos la search-organizations; searchDecisionMakers no esta tracked.
  console.log(
    `search-leads done: total=${orgs.length} inserted=${inserted} duplicates=${duplicates} contacts=${contactsAdded} credits=${creditsUsed}`,
  );
}

function parseCsv(input?: string): string[] | null {
  if (!input) return null;
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function parseSemicolonList(input?: string): string[] | null {
  if (!input) return null;
  const parts = input
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function normalizeWebsite(url: string): string {
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function buildRegion(org: apollo.ApolloOrganization): string | null {
  const parts = [org.city, org.state, org.country].filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(', ') : null;
}

function buildContactName(p: apollo.ApolloPersonTeaser): string {
  const first = p.first_name?.trim() ?? '';
  const lastObf = p.last_name_obfuscated?.trim() ?? '';
  const combined = [first, lastObf].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  if (first) return first;
  return p.title ?? 'Decision Maker';
}

async function upsertCampaign(
  db: DbClient,
  name: string,
  venture: SearchLeadsVenture,
  regionFocus: string | null,
): Promise<string> {
  const { data: existing } = await db
    .from('campaigns')
    .select('id')
    .eq('name', name)
    .eq('venture', venture)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db
    .from('campaigns')
    .insert({
      name,
      venture,
      region_focus: regionFocus,
      status: 'active',
    } as never)
    .select('id')
    .single();

  if (error) throw new Error(`upsert campaign: ${error.message}`);
  return (data as { id: string }).id;
}
