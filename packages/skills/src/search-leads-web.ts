import { createAdminClient, createLogger, fetchAllRows, writeErrorLog } from '@wobox/core';
import { apify } from '@wobox/integrations';

export const DEFAULT_MODEL = 'haiku';

export interface SearchLeadsWebOptions {
  subsector?: string;
  city?: string;
  neighborhood?: string;
  campaign?: string;
  limit?: string;
  model?: string;
}

// Mapea sub-sectores a queries mas efectivas para Google Maps en AR.
const SUBSECTOR_QUERIES: Record<string, string[]> = {
  cafeteria: ['cafeteria', 'cafe de especialidad'],
  restaurante: ['restaurante'],
  panaderia: ['panaderia'],
  rotiseria: ['rotiseria', 'delicatessen'],
  heladeria: ['heladeria artesanal'],
  peluqueria: ['peluqueria', 'barberia'],
  estetica: ['centro de estetica', 'spa'],
  pilates: ['estudio de pilates'],
  yoga: ['estudio de yoga'],
  gym: ['gimnasio', 'crossfit', 'estudio funcional'],
  libreria: ['libreria'],
  dietetica: ['dietetica'],
  farmacia: ['farmacia'],
};

export async function run(opts: SearchLeadsWebOptions): Promise<void> {
  const log = createLogger('search-leads-web');
  const db = createAdminClient();

  const subsector = opts.subsector ?? 'cafeteria';
  const city = opts.city ?? 'Buenos Aires';
  const neighborhood = opts.neighborhood ?? null;
  const limit = Number.parseInt(opts.limit ?? '30', 10);

  const baseQueries = SUBSECTOR_QUERIES[subsector] ?? [subsector];
  const searchStrings = baseQueries.map((q) => [q, neighborhood, city].filter(Boolean).join(' '));

  log.info({ subsector, city, neighborhood, limit, searchStrings }, 'running Apify google-maps');

  let places: apify.MapsPlace[];
  try {
    places = await apify.runGoogleMapsSearch({
      searchStringsArray: searchStrings,
      ...(neighborhood ? { locationQuery: `${neighborhood}, ${city}` } : { locationQuery: city }),
      maxCrawledPlacesPerSearch: limit,
    });
  } catch (err) {
    log.error({ err }, 'apify run failed');
    await writeErrorLog(db, {
      skill: 'search-leads-web',
      error: err,
      context: { subsector, city, neighborhood, searchStrings },
    });
    throw err;
  }

  await db.from('api_usage').insert({
    service: 'apify',
    operation: 'google-maps-search',
    credits_used: places.length,
    tokens_used: null,
    venture: 'loop',
  });

  log.info({ returned: places.length }, 'apify returned places');

  if (places.length === 0) {
    log.warn('no places returned; ajustar queries o locationQuery');
    return;
  }

  // Optional campaign.
  let campaignId: string | null = null;
  if (opts.campaign) {
    campaignId = await upsertCampaign(db, opts.campaign, subsector, city);
  }

  // Dedup: cargar companies existentes de venture=loop para matchear.
  // Paginado con .range(): un select plano se corta en 1000 filas y perderia dedup.
  const existing = await fetchAllRows<Record<string, unknown>>((from, to) =>
    db
      .from('companies')
      .select('name, website, website_normalized, instagram_handle, region, neighborhood')
      .eq('venture', 'loop')
      .order('id')
      .range(from, to),
  );

  const seenWebsite = new Set<string>();
  const seenIg = new Set<string>();
  const seenNameRegion = new Set<string>();
  for (const c of existing) {
    const wn = (c.website_normalized as string | null) ?? '';
    if (wn) seenWebsite.add(wn);
    const ig = (c.instagram_handle as string | null) ?? '';
    if (ig) seenIg.add(ig.toLowerCase());
    const nameKey = `${String(c.name).toLowerCase().trim()}::${String(c.region ?? '').toLowerCase()}`;
    seenNameRegion.add(nameKey);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  let duplicates = 0;
  let invalid = 0;

  for (const p of places) {
    if (!p.title) {
      invalid += 1;
      continue;
    }
    if (p.permanentlyClosed || p.temporarilyClosed) {
      invalid += 1;
      continue;
    }

    const website = p.website?.trim() ?? null;
    const websiteNorm = website ? normalizeWebsite(website) : '';
    const igFromWebsite = website ? extractInstagramHandle(website) : null;
    const nameKey = `${p.title.toLowerCase().trim()}::${city.toLowerCase()}`;

    const isDup =
      (websiteNorm && seenWebsite.has(websiteNorm)) ||
      (igFromWebsite && seenIg.has(igFromWebsite.toLowerCase())) ||
      seenNameRegion.has(nameKey);

    if (isDup) {
      duplicates += 1;
      continue;
    }

    if (websiteNorm) seenWebsite.add(websiteNorm);
    if (igFromWebsite) seenIg.add(igFromWebsite.toLowerCase());
    seenNameRegion.add(nameKey);

    toInsert.push({
      name: p.title,
      venture: 'loop',
      subsector,
      locations_count: 1,
      is_franchise: false,
      franchise_type: 'not_franchise',
      region: city,
      neighborhood: p.neighborhood ?? neighborhood,
      website,
      instagram_handle: igFromWebsite,
      social_source: igFromWebsite ? 'instagram' : 'pending',
      stage: 'new',
      source: 'web_search',
      campaign_id: campaignId,
    });
  }

  if (toInsert.length === 0) {
    log.info({ duplicates, invalid, returned: places.length }, 'no new leads to insert');
    return;
  }

  const { error: insertErr, data: inserted } = await db
    .from('companies')
    .insert(toInsert as never)
    .select('id, name');

  if (insertErr) throw new Error(`insert companies: ${insertErr.message}`);

  log.info(
    {
      returned: places.length,
      inserted: inserted?.length ?? toInsert.length,
      duplicates,
      invalid,
    },
    'search-leads-web done',
  );
}

function normalizeWebsite(url: string): string {
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function extractInstagramHandle(url: string): string | null {
  const match = url.match(/instagram\.com\/([a-z0-9._]+)/i);
  return match?.[1] ? match[1].replace(/\/$/, '') : null;
}

async function upsertCampaign(
  db: ReturnType<typeof createAdminClient>,
  name: string,
  subsector: string,
  city: string,
): Promise<string> {
  const { data: existing } = await db.from('campaigns').select('id').eq('name', name).maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db
    .from('campaigns')
    .insert({
      name,
      venture: 'loop',
      vertical_focus: subsector,
      region_focus: city,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) throw new Error(`upsert campaign: ${error.message}`);
  return (data as { id: string }).id;
}
