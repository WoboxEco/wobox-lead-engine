import { type DbClient, createAdminClient, createLogger, fetchAllRows } from '@wobox/core';

export interface SourcingCasOptions {
  /** Limite de socios a procesar (default: todos) */
  limit?: string;
  /** Pagina inicial (default: 1) */
  startPage?: string;
  /** No insertar nada, solo loguear */
  dryRun?: boolean;
  /** Stage para companies importadas (default: new) */
  stage?: string;
  /** Filtrar por categoria de CAS: alimentos | servicios | productos-saludables (default: todas) */
  category?: string;
}

const BASE = 'https://cas.com.ar';
const UA = 'Mozilla/5.0 (compatible; WoboxLeadEngine/1.0)';

interface CasListing {
  name: string; // brand display, ej "AIELLO"
  slug: string; // ej "aiello"
  url: string; // /producto/aiello/
  category: string; // alimentos | servicios | productos-saludables | unknown
}

interface CasDetail {
  empresa: string | null;
  actividad: string | null;
  direccion: string | null;
  telefono: string | null;
  emailEmpresa: string | null;
  contacto: string | null;
  cargo: string | null;
  emailContacto: string | null;
  detalleProductos: string | null;
}

export async function run(opts: SourcingCasOptions): Promise<void> {
  const log = createLogger('sourcing-cas');
  const db = createAdminClient();

  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : Number.POSITIVE_INFINITY;
  const startPage = opts.startPage ? Number.parseInt(opts.startPage, 10) : 1;
  const dryRun = !!opts.dryRun;
  const stage = opts.stage ?? 'new';
  const categoryFilter = opts.category ?? null;

  log.info({ limit, startPage, dryRun, stage, categoryFilter }, 'starting CAS sourcing');

  // 1) Fetch listing pages hasta agotar.
  // WordPress devuelve la home con productos cuando se pide una pagina inexistente
  // (no 404), asi que detectamos fin via slugs duplicados: si la pagina N no trae
  // ningun slug nuevo, ya recorrimos todo.
  const listings: CasListing[] = [];
  const seenSlugs = new Set<string>();
  let page = startPage;
  const MAX_PAGES = 30; // hard cap (CAS tiene 12 paginas, esto es buffer)
  while (listings.length < limit && page <= startPage + MAX_PAGES) {
    // Pagina 1 usa la URL canonica; las siguientes usan ?product-page=N
    // (NO /page/N/ — ese path devuelve la home y dispara loop infinito)
    const url = page === 1 ? `${BASE}/directorio/` : `${BASE}/directorio/?product-page=${page}`;
    log.info({ page, url }, 'fetching listing page');
    const html = await fetchText(url);
    if (!html) {
      log.warn({ page }, 'pagina vacia, terminando');
      break;
    }
    const items = parseListingPage(html);
    if (items.length === 0) {
      log.info({ page }, 'sin items, fin de paginacion');
      break;
    }
    const newItems = items.filter((it) => !seenSlugs.has(it.slug));
    if (newItems.length === 0) {
      log.info({ page, totalItems: items.length }, 'pagina solo con slugs ya vistos, fin');
      break;
    }
    for (const it of newItems) seenSlugs.add(it.slug);
    listings.push(...newItems);
    page++;
    await sleep(300);
  }

  const filtered = categoryFilter
    ? listings.filter((l) => l.category === categoryFilter)
    : listings;
  const truncated = filtered.slice(0, limit);
  console.log(
    `\nListings encontrados: ${listings.length} (filtrados: ${filtered.length}, a procesar: ${truncated.length})`,
  );

  if (truncated.length === 0) {
    console.log('Nada para procesar.');
    return;
  }

  // 2) Pre-cargar dedup por website (CAS no expone hubspot_id)
  const existingNames = new Set<string>();
  // Paginado con .range(): wobox_food tiene >1000 companies y un select plano se corta.
  const existing = await fetchAllRows<{ name: string }>((from, to) =>
    db.from('companies').select('name').eq('venture', 'wobox_food').order('id').range(from, to),
  );
  for (const r of existing) {
    existingNames.add(r.name.toLowerCase().trim());
  }
  log.info({ existing: existingNames.size }, 'companies wobox_food precargadas para dedup');

  // 3) Por cada listing, fetch ficha y armar payload
  let inserted = 0;
  let skippedExisting = 0;
  let skippedNoData = 0;
  let contactsInserted = 0;

  for (const item of truncated) {
    try {
      const detail = await fetchDetail(item.url);
      const companyName = detail.empresa ?? item.name;
      const dedupKey = companyName.toLowerCase().trim();

      if (existingNames.has(dedupKey)) {
        skippedExisting++;
        continue;
      }

      if (!detail.empresa && !detail.emailEmpresa && !detail.telefono) {
        // Ficha sin datos utiles, skip
        skippedNoData++;
        log.warn({ slug: item.slug }, 'ficha sin datos utiles');
        continue;
      }

      const subsector = mapCategoryToSubsector(item.category, detail.actividad);
      const region = detail.direccion ?? null;

      if (dryRun) {
        console.log(
          `[DRY] ${companyName} | ${detail.actividad ?? '-'} | ${detail.emailEmpresa ?? '-'} | ${detail.contacto ?? '-'}`,
        );
        inserted++;
        existingNames.add(dedupKey);
        continue;
      }

      const companyId = await insertCompany(db, companyName, item.url, subsector, region, stage);
      inserted++;
      existingNames.add(dedupKey);

      const added = await insertContact(db, companyId, detail);
      contactsInserted += added;
    } catch (err) {
      log.error({ err: String(err), slug: item.slug }, 'fallo procesando ficha');
    }
    await sleep(250);
  }

  console.log(
    `\nsourcing-cas done: inserted=${inserted} skippedExisting=${skippedExisting} skippedNoData=${skippedNoData} contacts=${contactsInserted}${dryRun ? ' (DRY)' : ''}`,
  );

  if (!dryRun) {
    await db.from('api_usage').insert({
      service: 'cas-scrape',
      operation: 'sourcing',
      credits_used: 0,
      tokens_used: null,
      venture: 'wobox_food',
    });
  }
}

// ========================
// Fetch helpers
// ========================

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    if (res.status === 404) return '';
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ========================
// Listing parser
// ========================

function parseListingPage(html: string): CasListing[] {
  const out: CasListing[] = [];
  // Match cada li.product con sus clases (incluye product_cat-XXX)
  const liRe = /<li class="product[^"]*?"[^>]*>([\s\S]*?)<\/li>/g;
  for (const liMatch of html.matchAll(liRe)) {
    const liFull = liMatch[0];
    const liInner = liMatch[1] ?? '';

    // Extraer categoria
    const catMatch = liFull.match(/product_cat-([\w-]+)/);
    const category = catMatch ? catMatch[1]! : 'unknown';

    // Extraer href + nombre
    const aMatch = liInner.match(
      /<a href="([^"]+)"[^>]*class="[^"]*woocommerce-LoopProduct-link[^"]*"[^>]*>[\s\S]*?<h2 class="woocommerce-loop-product__title">([^<]+)<\/h2>/,
    );
    if (!aMatch) continue;
    const url = aMatch[1]!;
    const name = decodeHtml(aMatch[2]!.trim());
    const slugMatch = url.match(/\/producto\/([^/]+)\/?$/);
    const slug = slugMatch ? slugMatch[1]! : url;

    out.push({ name, slug, url, category });
  }
  return out;
}

// ========================
// Detail parser
// ========================

const FIELD_LABELS: Record<keyof CasDetail, string[]> = {
  empresa: ['Empresa'],
  actividad: ['Principal actividad', 'Actividad principal', 'Actividad'],
  direccion: ['Dirección', 'Direccion'],
  telefono: ['Teléfono', 'Telefono'],
  emailEmpresa: ['Email de la empresa', 'E-mail de la empresa', 'Email empresa'],
  contacto: ['Contacto'],
  cargo: ['Cargo'],
  emailContacto: ['Email del contacto', 'E-mail del contacto', 'Email contacto'],
  detalleProductos: ['Detalle de productos', 'Productos'],
};

async function fetchDetail(url: string): Promise<CasDetail> {
  const html = await fetchText(url);
  const detail: CasDetail = {
    empresa: null,
    actividad: null,
    direccion: null,
    telefono: null,
    emailEmpresa: null,
    contacto: null,
    cargo: null,
    emailContacto: null,
    detalleProductos: null,
  };

  // Aislar el bloque description (donde esta la data)
  const descBlock = extractBetween(
    html,
    '<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--description',
    '</div>',
  );
  const target = descBlock || html;

  for (const key of Object.keys(FIELD_LABELS) as Array<keyof CasDetail>) {
    for (const label of FIELD_LABELS[key]) {
      const value = extractField(target, label);
      if (value) {
        detail[key] = value;
        break;
      }
    }
  }
  return detail;
}

function extractField(html: string, label: string): string | null {
  // Pattern: <strong>Label:</strong> value</p>  o   <strong>Label:</strong> <a href="mailto:x">x</a></p>
  // El terminador NO puede ser solo </p>: WordPress a veces emite <p> sin cerrar y
  // los campos quedan en un mismo <p> separados por <br> o por el proximo <strong>.
  // Por eso cortamos la captura en lo que venga primero: <br | </p | </div | <strong | fin.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<strong>\\s*${escaped}\\s*:\\s*</strong>\\s*([\\s\\S]*?)(?:<br|</p|</div|<strong|$)`,
    'i',
  );
  const m = html.match(re);
  if (!m) return null;
  let raw = m[1] ?? '';
  // Si tiene un mailto, sacar el email
  const mailto = raw.match(/href="mailto:([^"]+)"/);
  if (mailto) return mailto[1]!.trim();
  // Sino, strip tags
  raw = raw.replace(/<[^>]+>/g, '').trim();
  return decodeHtml(raw) || null;
}

function extractBetween(html: string, start: string, end: string): string | null {
  const i = html.indexOf(start);
  if (i < 0) return null;
  const j = html.indexOf(end, i + start.length);
  if (j < 0) return null;
  return html.slice(i, j);
}

function decodeHtml(s: string): string {
  return (
    s
      // entities numericas primero (decimal y hex): &#8211; &#8217; &#x2014; ...
      .replace(/&#(\d+);/g, (_, n) => fromCodePointSafe(Number.parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => fromCodePointSafe(Number.parseInt(n, 16)))
      // entities nombradas comunes
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // &amp; ultimo para no des-escapar de mas (&amp;lt; -> &lt;)
      .replace(/&amp;/g, '&')
  );
}

function fromCodePointSafe(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

// ========================
// Mapping
// ========================

function mapCategoryToSubsector(category: string, actividad: string | null): string | null {
  if (actividad) return actividad.slice(0, 100);
  switch (category) {
    case 'alimentos':
      return 'alimentos';
    case 'productos-saludables':
      return 'productos saludables';
    case 'servicios':
      return 'servicios';
    default:
      return null;
  }
}

// ========================
// Inserts
// ========================

async function insertCompany(
  db: DbClient,
  name: string,
  sourceUrl: string,
  subsector: string | null,
  region: string | null,
  stage: string,
): Promise<string> {
  const { data, error } = await db
    .from('companies')
    .insert({
      name,
      venture: 'wobox_food',
      stage,
      source: 'manual',
      subsector,
      region,
      website: sourceUrl,
    } as never)
    .select('id')
    .single();
  if (error) throw new Error(`insert company "${name}": ${error.message}`);
  return (data as { id: string }).id;
}

async function insertContact(db: DbClient, companyId: string, detail: CasDetail): Promise<number> {
  // Si no hay nombre de contacto pero si email empresa, creamos un contact con email empresa
  // Si hay nombre + email contacto, ese es el decision maker (probablemente)
  const contacts: Array<Record<string, unknown>> = [];

  if (detail.contacto) {
    contacts.push({
      company_id: companyId,
      name: detail.contacto,
      role: detail.cargo ?? null,
      email: (detail.emailContacto ?? detail.emailEmpresa)?.toLowerCase() ?? null,
      phone: detail.telefono ?? null,
      contact_source: 'CAS',
      is_decision_maker: !!detail.cargo,
      // Si tenemos email + nombre + cargo, es un warm path direct
      warm_path: detail.emailContacto && detail.cargo ? 'direct' : null,
    });
  } else if (detail.emailEmpresa) {
    contacts.push({
      company_id: companyId,
      name: 'Contacto general',
      role: null,
      email: detail.emailEmpresa.toLowerCase(),
      phone: detail.telefono ?? null,
      contact_source: 'CAS',
      is_decision_maker: false,
    });
  }

  if (contacts.length === 0) return 0;

  const { error } = await db.from('contacts').insert(contacts as never);
  if (error) throw new Error(`insert contacts: ${error.message}`);
  return contacts.length;
}
