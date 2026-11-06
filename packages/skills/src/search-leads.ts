import { createHash } from 'node:crypto';
import {
  type DbClient,
  createAdminClient,
  createLogger,
  fetchAllRows,
  writeErrorLog,
} from '@wobox/core';
import { apollo } from '@wobox/integrations';
import {
  FASHION_EMPLOYEE_RANGES,
  FASHION_INDUSTRIES_BY_SUBSECTOR,
  FASHION_KEYWORDS_BY_SUBSECTOR,
  FASHION_KEYWORD_TAGS_BY_SUBSECTOR,
  FASHION_SUBSECTORS,
  type FashionSubsector,
  checkFashionIcp,
} from './fashion-icp.js';
import type { SearchLeadsResult } from './prospect-summary.js';

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
  /** Máximo de páginas a pedir si las anteriores no traen nuevos (default MAX_PAGES_PER_RUN). */
  maxPages?: number;
  /** Dashboard: no pedir otra página si ya pasó este tiempo (ms) desde el arranque. */
  timeBudgetMs?: number;
}

export { FASHION_SUBSECTORS, type FashionSubsector } from './fashion-icp.js';

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
// wobox_food: `industries` va a `q_organization_keyword_tags` (text-match, no hard filter) y
// `keywords` a `q_keywords`.
// wobox_fashion: `industries` se resuelve a `organization_industry_tag_ids` (hard filter, ver
// apollo.resolveIndustryTagIds) y no se manda `q_keywords` (salvo --keywords explícito). Si no
// se resuelve ningún ID, cae al text-match de antes. Además corre el pre-filtro sin IA de
// fashion-icp.ts antes de insertar.
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
  // ICP afinado con las marcas que contactamos (Key Biscayne, Jackie Smith, Cibeles, RUMA…):
  // marcas argentinas de indumentaria/calzado/carteras con marca propia, e-commerce y locales.
  // Muebles/deco solo con --subsector=muebles_deco.
  wobox_fashion: {
    industries: FASHION_INDUSTRIES_BY_SUBSECTOR.todos,
    keywords: FASHION_KEYWORDS_BY_SUBSECTOR.todos,
    employeeRanges: FASHION_EMPLOYEE_RANGES,
    locations: ['Argentina'],
    excludeIndustries: COMMON_EXCLUDES,
  },
};

/** Máximo de páginas de Apollo (1 crédito c/u) por corrida si las primeras no traen nuevos. */
export const MAX_PAGES_PER_RUN = 3;

/** Concurrencia para inserts + búsqueda de decision-makers (Apollo) por org. */
const ORG_CONCURRENCY = 5;

export type { SearchLeadsResult } from './prospect-summary.js';

export async function run(opts: SearchLeadsOptions): Promise<SearchLeadsResult> {
  const log = createLogger('search-leads');
  const db = createAdminClient();
  const startedAt = Date.now();

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
    presetIndustries = FASHION_INDUSTRIES_BY_SUBSECTOR[subsector as FashionSubsector];
    presetKeywords = FASHION_KEYWORDS_BY_SUBSECTOR[subsector as FashionSubsector];
  }
  const fashionSubsector: FashionSubsector | null =
    venture === 'wobox_fashion' ? ((subsector as FashionSubsector | undefined) ?? 'todos') : null;

  // CSV simple para industries / exclude / locations; ; para employeeRanges (los valores ya tienen ,).
  const industries = parseCsv(opts.industries) ?? presetIndustries;
  const employeeRanges = parseSemicolonList(opts.employeeRanges) ?? defaults.employeeRanges;
  const excludeIndustries = parseCsv(opts.excludeIndustries) ?? defaults.excludeIndustries;
  const locations = opts.region ? [opts.region] : defaults.locations;
  let keywords = opts.keywords ?? presetKeywords;

  // Fashion: filtro duro por industry tag IDs. Si no se resuelve ninguno, text-match como antes.
  let industryTagIds: string[] = [];
  if (venture === 'wobox_fashion') {
    const tags = await apollo.resolveIndustryTagIds(industries);
    industryTagIds = tags.ids;
    log.info(
      { resolved: tags.resolved, missing: tags.missing },
      'apollo industry tag ids (copiar los resueltos a KNOWN_INDUSTRY_TAG_IDS)',
    );
    if (industryTagIds.length > 0 && !opts.keywords) keywords = '';
    if (industryTagIds.length === 0) {
      log.warn({ industries }, 'sin tag IDs de industria: uso keyword tags (text-match)');
    }
  }
  const industryMode = industryTagIds.length > 0 ? 'tag_ids' : 'keyword_tags';
  // Con tag IDs, el rubro (ej. calzado) se acota con keyword tags dentro de la industria.
  const keywordTags =
    industryMode === 'tag_ids' && fashionSubsector
      ? FASHION_KEYWORD_TAGS_BY_SUBSECTOR[fashionSubsector]
      : [];

  const perPage = opts.limit ? Number.parseInt(opts.limit, 10) : 25;
  const dryRun = !!opts.dryRun;
  // En dry-run pedimos una sola página: cada página es 1 crédito real.
  const maxPages = dryRun ? 1 : Math.max(1, opts.maxPages ?? MAX_PAGES_PER_RUN);

  const filters = buildCursorFilters({
    venture,
    subsector: subsector ?? null,
    industries,
    keywords,
    employeeRanges,
    locations,
    industryMode,
  });
  const filtersHash = hashFilters(filters);

  const cursor = await readCursor(db, venture, filtersHash, log);
  const startPage = cursor?.next_page ?? 1;
  let totalPages: number | null = cursor?.total_pages ?? null;

  const result: SearchLeadsResult = {
    inserted: 0,
    duplicates: 0,
    filteredOut: 0,
    pagesFetched: 0,
    page: startPage,
    totalPages,
    credits: 0,
    exhausted: false,
    contactsAdded: 0,
    insertedIds: [],
  };

  if (totalPages !== null && startPage > totalPages) {
    result.exhausted = true;
    console.log(
      `search-leads: agotado para venture=${venture} (página ${startPage} > ${totalPages}). Probá otro rubro o región.`,
    );
    return result;
  }

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
      filtersHash,
      startPage,
      totalPages,
    },
    'apollo searchOrganizations',
  );

  // Optional campaign upsert (se omite en dry-run para no escribir nada).
  let campaignId: string | null = null;
  if (opts.campaign && !dryRun) {
    campaignId = await upsertCampaign(db, opts.campaign, venture, locations[0] ?? null);
  }

  const seen = await loadSeenKeys(db, venture);

  let page = startPage;
  while (result.pagesFetched < maxPages) {
    // Presupuesto de tiempo (dashboard): no arrancar otra página si ya no entra.
    if (
      result.pagesFetched > 0 &&
      opts.timeBudgetMs !== undefined &&
      Date.now() - startedAt > opts.timeBudgetMs
    ) {
      log.info({ elapsedMs: Date.now() - startedAt }, 'time budget reached, stop paginating');
      break;
    }

    let res: apollo.SearchOrganizationsResult;
    try {
      res = await apollo.searchOrganizations({
        industries,
        industryTagIds,
        keywordTags,
        excludeIndustries,
        locations,
        employeeRanges,
        keywords,
        page,
        perPage,
      });
    } catch (err) {
      log.error({ err, page }, 'apollo searchOrganizations failed');
      await writeErrorLog(db, {
        skill: 'search-leads',
        error: err,
        context: {
          venture,
          industries,
          employeeRanges,
          excludeIndustries,
          locations,
          perPage,
          page,
        },
      });
      // Si ya pedimos alguna página, guardamos el avance antes de propagar.
      if (result.pagesFetched > 0 && !dryRun) {
        await saveCursor(db, venture, filtersHash, filters, page, totalPages, log);
      }
      throw err;
    }

    result.pagesFetched += 1;
    result.credits += 1;
    result.page = page;
    totalPages = res.totalPages;
    result.totalPages = totalPages;

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

    const orgs = res.organizations;
    log.info(
      { page, returned: orgs.length, totalEntries: res.totalEntries, totalPages },
      'apollo returned organizations',
    );

    const pageStats = await processOrgs(db, orgs, {
      venture,
      fashionSubsector,
      campaignId,
      dryRun,
      seen,
      log,
    });
    result.inserted += pageStats.inserted;
    result.duplicates += pageStats.duplicates;
    result.filteredOut += pageStats.filteredOut;
    result.contactsAdded += pageStats.contactsAdded;
    result.insertedIds.push(...pageStats.insertedIds);

    page += 1;
    if (orgs.length === 0 || page > totalPages) {
      result.exhausted = true;
      break;
    }
    if (pageStats.inserted > 0) break;
  }

  if (!dryRun) {
    await saveCursor(db, venture, filtersHash, filters, page, totalPages, log);
  }

  const pageText = `página ${result.page}${totalPages ? ` de ${totalPages}` : ''}`;
  if (dryRun) {
    console.log(
      `\nsearch-leads [DRY]: ${pageText} nuevos=${result.inserted} duplicates=${result.duplicates} filtrados_rubro=${result.filteredOut} (no se insertó nada, no se buscaron decision-makers, no se avanzó el cursor).`,
    );
    console.log(
      `Nota: la búsqueda de organizaciones en Apollo consumió ${result.credits} crédito(s) real(es) (no trackeado).`,
    );
    return result;
  }

  // Solo contamos search-organizations; searchDecisionMakers no esta tracked.
  console.log(
    `search-leads done: ${pageText} pages=${result.pagesFetched} inserted=${result.inserted} duplicates=${result.duplicates} filtrados_rubro=${result.filteredOut} contacts=${result.contactsAdded} credits=${result.credits}${result.exhausted ? ' (agotado: probá otro rubro o región)' : ''}`,
  );
  return result;
}

type SeenKeys = { website: Set<string>; linkedin: Set<string>; name: Set<string> };

/** Dedup contra companies existentes de la misma venture. */
async function loadSeenKeys(db: DbClient, venture: SearchLeadsVenture): Promise<SeenKeys> {
  // Paginado con .range(): un select plano se corta en 1000 filas y perderia dedup.
  const existing = await fetchAllRows<Record<string, unknown>>((from, to) =>
    db
      .from('companies')
      .select('name, website_normalized, linkedin_url')
      .eq('venture', venture)
      .order('id')
      .range(from, to),
  );

  const seen: SeenKeys = { website: new Set(), linkedin: new Set(), name: new Set() };
  for (const c of existing) {
    const wn = (c.website_normalized as string | null) ?? '';
    if (wn) seen.website.add(wn);
    const li = (c.linkedin_url as string | null) ?? '';
    if (li) seen.linkedin.add(li.toLowerCase());
    const name = String(c.name ?? '')
      .toLowerCase()
      .trim();
    if (name) seen.name.add(name);
  }
  return seen;
}

async function processOrgs(
  db: DbClient,
  orgs: apollo.ApolloOrganization[],
  ctx: {
    venture: SearchLeadsVenture;
    /** Solo wobox_fashion: activa el pre-filtro de rubro. */
    fashionSubsector: FashionSubsector | null;
    campaignId: string | null;
    dryRun: boolean;
    seen: SeenKeys;
    log: ReturnType<typeof createLogger>;
  },
): Promise<{
  inserted: number;
  duplicates: number;
  filteredOut: number;
  contactsAdded: number;
  insertedIds: string[];
}> {
  const { venture, fashionSubsector, campaignId, dryRun, seen, log } = ctx;
  let duplicates = 0;
  let filteredOut = 0;
  const fresh: apollo.ApolloOrganization[] = [];

  // Pre-filtro de rubro (sin IA) + dedup sincrónico (también dentro de la página) antes de insertar.
  for (const org of orgs) {
    if (fashionSubsector) {
      const verdict = checkFashionIcp(org, fashionSubsector);
      if (!verdict.ok) {
        filteredOut += 1;
        log.info({ name: org.name, reason: verdict.reason }, 'filtrado por rubro');
        if (dryRun) console.log(`[DRY][filtrado] ${org.name} — ${verdict.reason}`);
        continue;
      }
    }

    const websiteNorm = org.website_url ? normalizeWebsite(org.website_url) : '';
    const linkedinKey = (org.linkedin_url ?? '').toLowerCase();
    const nameKey = (org.name ?? '').toLowerCase().trim();

    const isDup =
      (websiteNorm && seen.website.has(websiteNorm)) ||
      (linkedinKey && seen.linkedin.has(linkedinKey)) ||
      (nameKey && seen.name.has(nameKey));

    if (isDup) {
      duplicates += 1;
      continue;
    }

    if (websiteNorm) seen.website.add(websiteNorm);
    if (linkedinKey) seen.linkedin.add(linkedinKey);
    if (nameKey) seen.name.add(nameKey);
    fresh.push(org);
  }

  if (dryRun) {
    for (const org of fresh) {
      console.log(`[DRY] ${org.name} | ${buildRegion(org) ?? '-'} | ${org.website_url ?? '-'}`);
    }
    // contamos como "se insertaría"
    return { inserted: fresh.length, duplicates, filteredOut, contactsAdded: 0, insertedIds: [] };
  }

  const insertedIds: string[] = [];
  let contactsAdded = 0;

  await mapLimit(fresh, ORG_CONCURRENCY, async (org) => {
    const { data: companyRow, error: insertErr } = await db
      .from('companies')
      .insert({
        name: org.name,
        venture,
        website: org.website_url ?? null,
        linkedin_url: org.linkedin_url ?? null,
        region: buildRegion(org),
        source: 'apollo',
        stage: 'new',
        // La industria de Apollo le da contexto al scoring (no hay columna de empleados).
        ...(org.industry ? { subsector: org.industry } : {}),
        ...(venture === 'wobox_fashion' ? { vertical: 'fashion' } : {}),
        apollo_id: org.id,
        campaign_id: campaignId,
      } as never)
      .select('id')
      .single();

    if (insertErr) {
      log.warn({ err: insertErr.message, name: org.name }, 'insert company failed');
      return;
    }

    const companyId = (companyRow as { id: string } | null)?.id;
    if (!companyId) return;
    insertedIds.push(companyId);

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
  });

  return { inserted: insertedIds.length, duplicates, filteredOut, contactsAdded, insertedIds };
}

/** Filtros efectivos que identifican un cursor (normalizados: orden de arrays y mayúsculas no importan). */
export interface CursorFilters {
  venture: string;
  subsector: string | null;
  industries: string[];
  keywords: string;
  employeeRanges: string[];
  locations: string[];
  /** 'tag_ids' = filtro duro por industria; 'keyword_tags' = text-match (default histórico). */
  industryMode?: 'tag_ids' | 'keyword_tags';
}

export function buildCursorFilters(f: CursorFilters): CursorFilters {
  const norm = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()))].sort();
  return {
    venture: f.venture,
    subsector: f.subsector && f.subsector !== 'todos' ? f.subsector : null,
    industries: norm(f.industries),
    keywords: f.keywords.trim().toLowerCase().replace(/\s+/g, ' '),
    employeeRanges: norm(f.employeeRanges),
    locations: norm(f.locations),
    industryMode: f.industryMode ?? 'keyword_tags',
  };
}

export function hashFilters(filters: CursorFilters): string {
  // Orden de keys fijo (el de la interfaz) para que el hash sea estable.
  const parts: unknown[] = [
    filters.venture,
    filters.subsector,
    filters.industries,
    filters.keywords,
    filters.employeeRanges,
    filters.locations,
  ];
  // Solo se agrega en modo tag_ids: los cursores existentes (keyword_tags) conservan su hash.
  if (filters.industryMode === 'tag_ids') parts.push('tag_ids');
  const canonical = JSON.stringify(parts);
  return createHash('sha256').update(canonical).digest('hex');
}

async function readCursor(
  db: DbClient,
  venture: SearchLeadsVenture,
  filtersHash: string,
  log: ReturnType<typeof createLogger>,
): Promise<{ next_page: number; total_pages: number | null } | null> {
  const { data, error } = await db
    .from('sourcing_cursors')
    .select('next_page, total_pages')
    .eq('venture', venture)
    .eq('filters_hash', filtersHash)
    .maybeSingle();
  if (error) {
    // Ej: migration 0010 sin aplicar. Seguimos desde la página 1 (comportamiento viejo).
    log.warn({ err: error.message }, 'read sourcing_cursors failed, starting at page 1');
    return null;
  }
  if (!data) return null;
  const row = data as { next_page: number | null; total_pages: number | null };
  return { next_page: Math.max(1, row.next_page ?? 1), total_pages: row.total_pages };
}

async function saveCursor(
  db: DbClient,
  venture: SearchLeadsVenture,
  filtersHash: string,
  filters: CursorFilters,
  nextPage: number,
  totalPages: number | null,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const { error } = await db.from('sourcing_cursors').upsert(
    {
      venture,
      filters_hash: filtersHash,
      filters,
      next_page: nextPage,
      total_pages: totalPages,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'venture,filters_hash' },
  );
  if (error) log.warn({ err: error.message }, 'save sourcing_cursors failed');
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
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
