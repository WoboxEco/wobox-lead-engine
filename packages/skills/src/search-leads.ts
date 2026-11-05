import {
  type DbClient,
  createAdminClient,
  createLogger,
  fetchAllRows,
  writeErrorLog,
} from '@wobox/core';
import { apollo } from '@wobox/integrations';

// Default: Haiku. Mantenido por parity con otras skills aunque hoy no se usa Claude aca.
export const DEFAULT_MODEL = 'haiku';

export type SearchLeadsVenture = 'wobox_food' | 'wobox_fashion';

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
  /**
   * No insertar nada ni buscar decision-makers; solo previsualizar qué orgs traería.
   * OJO: la búsqueda de organizaciones en Apollo igual se ejecuta (consume 1 crédito real),
   * porque sin llamar a la API no hay nada que previsualizar.
   */
  dryRun?: boolean;
  /**
   * Solo wobox_fashion: preset de rubro que pisa industries/keywords default.
   * ropa | calzado | muebles_deco | todos (default: todos = ICP completo).
   */
  subsector?: string;
}

export const FASHION_SUBSECTORS = ['ropa', 'calzado', 'muebles_deco', 'todos'] as const;
export type FashionSubsector = (typeof FASHION_SUBSECTORS)[number];

// Presets por rubro dentro de wobox_fashion. 'todos' usa los defaults del venture.
const FASHION_SUBSECTOR_PRESETS: Record<
  Exclude<FashionSubsector, 'todos'>,
  { industries: string[]; keywords: string }
> = {
  ropa: {
    industries: ['apparel and fashion', 'retail apparel and fashion', 'fashion accessories'],
    keywords: 'ropa indumentaria moda apparel clothing',
  },
  calzado: {
    industries: ['footwear', 'retail apparel and fashion', 'sporting goods'],
    keywords: 'calzado zapatillas zapatos footwear',
  },
  muebles_deco: {
    industries: [
      'furniture',
      'home furnishings',
      'retail furniture and home furnishings',
      'interior design',
    ],
    keywords: 'muebles decoracion deco hogar textil furniture home',
  },
};

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
//
// IMPORTANTE: estos van a `q_organization_keyword_tags` (text-match, no hard filter).
// Apollo no acepta `q_organization_industries`. Si querés hard match, pasale tag IDs
// via flag (no implementado en CLI todavia, requiere lookup separado).
//
// `keywords` se manda a `q_keywords` (general text) para reforzar la senal — sirve
// mucho cuando los keyword_tags solos son muy amplios.
//
// Excludes comunes: sectores que aparecen en AR con muchos empleados pero no son ICP.
const COMMON_EXCLUDES = [
  'staffing',
  'recruiting',
  'human resources',
  'financial services',
  'banking',
  'insurance',
  'consulting',
  'legal',
  'marketing',
  'advertising',
  'software',
  'information technology',
];

// loop usa search-leads-web (Apify Google Maps), no Apollo.
const DEFAULTS_BY_VENTURE: Record<
  SearchLeadsVenture,
  {
    industries: string[];
    keywords: string;
    employeeRanges: string[];
    locations: string[];
    excludeIndustries: string[];
  }
> = {
  // Wobox Food: marcas y retailers que mueven volumen perecedero (sobrestock).
  // ICP: supermercados, dieteticas, productores con marca propia, marcas de food retail.
  wobox_food: {
    industries: [
      'supermarkets',
      'food production',
      'food and beverage manufacturing',
      'wholesale food and beverage',
      'consumer goods',
    ],
    keywords: 'food retail supermercado alimentos consumo masivo',
    employeeRanges: ['11,50', '51,200', '201,500'],
    locations: ['Argentina'],
    excludeIndustries: COMMON_EXCLUDES,
  },
  // Wobox Fashion: marcas de moda + muebles/deco con tienda fisica + e-commerce.
  // ICP: brands con stock estacional o discontinuado (ropa, accesorios, calzado, muebles, deco).
  wobox_fashion: {
    industries: [
      'apparel and fashion',
      'retail apparel and fashion',
      'fashion accessories',
      'footwear',
      'furniture',
      'home furnishings',
    ],
    keywords: 'apparel fashion clothing moda indumentaria calzado muebles decoracion',
    employeeRanges: ['11,50', '51,200'],
    locations: ['Argentina'],
    excludeIndustries: COMMON_EXCLUDES,
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
      `search-leads: venture invalida "${opts.venture}". Esperado: wobox_food | wobox_fashion`,
    );
  }

  const defaults = DEFAULTS_BY_VENTURE[venture];

  let presetIndustries = defaults.industries;
  let presetKeywords = defaults.keywords;
  const subsector = opts.subsector?.trim();
  if (subsector) {
    if (!(FASHION_SUBSECTORS as readonly string[]).includes(subsector)) {
      throw new Error(
        `search-leads: subsector invalido "${subsector}". Esperado: ${FASHION_SUBSECTORS.join(' | ')}`,
      );
    }
    if (venture !== 'wobox_fashion') {
      throw new Error('search-leads: --subsector solo aplica a venture=wobox_fashion');
    }
    if (subsector !== 'todos') {
      const preset = FASHION_SUBSECTOR_PRESETS[subsector as Exclude<FashionSubsector, 'todos'>];
      presetIndustries = preset.industries;
      presetKeywords = preset.keywords;
    }
  }

  // CSV simple para industries / exclude / locations; ; para employeeRanges (los valores ya tienen ,).
  const industries = parseCsv(opts.industries) ?? presetIndustries;
  const employeeRanges = parseSemicolonList(opts.employeeRanges) ?? defaults.employeeRanges;
  const excludeIndustries = parseCsv(opts.excludeIndustries) ?? defaults.excludeIndustries;
  const locations = opts.region ? [opts.region] : defaults.locations;
  const keywords = opts.keywords ?? presetKeywords;

  const perPage = opts.limit ? Number.parseInt(opts.limit, 10) : 25;
  const dryRun = !!opts.dryRun;

  log.info(
    {
      venture,
      subsector,
      industries,
      keywords,
      employeeRanges,
      excludeIndustries,
      locations,
      perPage,
      dryRun,
    },
    'apollo searchOrganizations',
  );

  let result: apollo.SearchOrganizationsResult;
  try {
    result = await apollo.searchOrganizations({
      industries,
      excludeIndustries,
      locations,
      employeeRanges,
      keywords,
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
  // En dry-run la llamada igual se ejecutó (gastó 1 crédito real), pero no la registramos
  // en api_usage para no ensuciar el tracking de corridas "de verdad".
  if (!dryRun) {
    await db.from('api_usage').insert({
      service: 'apollo',
      operation: 'search-organizations',
      credits_used: 1,
      tokens_used: null,
      venture,
    });
  }

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

  // Optional campaign upsert (se omite en dry-run para no escribir nada).
  let campaignId: string | null = null;
  if (opts.campaign && !dryRun) {
    campaignId = await upsertCampaign(db, opts.campaign, venture, locations[0] ?? null);
  }

  // Dedup contra companies existentes de la misma venture.
  // Paginado con .range(): un select plano se corta en 1000 filas y perderia dedup.
  const existing = await fetchAllRows<Record<string, unknown>>((from, to) =>
    db
      .from('companies')
      .select('name, website_normalized, linkedin_url')
      .eq('venture', venture)
      .order('id')
      .range(from, to),
  );

  const seenWebsite = new Set<string>();
  const seenLinkedin = new Set<string>();
  const seenNameVenture = new Set<string>();
  for (const c of existing) {
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

    if (dryRun) {
      console.log(`[DRY] ${org.name} | ${region ?? '-'} | ${org.website_url ?? '-'}`);
      inserted += 1; // contamos como "se insertaría"
      continue;
    }

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

  if (dryRun) {
    console.log(
      `\nsearch-leads [DRY]: total=${orgs.length} nuevos=${inserted} duplicates=${duplicates} (no se insertó nada, no se buscaron decision-makers).`,
    );
    console.log(
      'Nota: la búsqueda de organizaciones en Apollo consumió 1 crédito real (no trackeado).',
    );
    return;
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
