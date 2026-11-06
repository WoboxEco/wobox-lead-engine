import { type DbClient, type Venture, createLogger } from '@wobox/core';
import { apify } from '@wobox/integrations';

/**
 * Canales de contacto a nivel company: telefono, WhatsApp, Instagram y email generico.
 *
 * Fuentes (en orden de costo):
 *   1. Scrape del website (home + /contacto + /contact) — gratis.
 *   2. Google Maps via Apify — ~1 credito por lugar, solo si falta telefono.
 *
 * `companies.enriched_at` marca "enriquecimiento de canales terminado": se setea cuando
 * ya hay telefono o cuando ya se intento Maps. Un pase sin Maps que no encontro telefono
 * lo deja en null para que un pase posterior con Maps lo levante.
 */

export interface ContactChannels {
  phone?: string;
  whatsapp?: string;
  instagram_handle?: string;
  generic_email?: string;
}

const SCRAPE_TIMEOUT_MS = 5000;
const SCRAPE_CONCURRENCY = 8;
export const DEFAULT_MAPS_LIMIT = 10;
const DEFAULT_CITY = 'Buenos Aires';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SOCIAL_DOMAINS = /(instagram|facebook|tiktok|twitter|x|linkedin|wa)\.(com|me)/i;

// ---------------------------------------------------------------------------
// Telefonos
// ---------------------------------------------------------------------------

/**
 * Normaliza un telefono argentino a E.164 (+54...). Celulares quedan como +549<area><numero>
 * (formato que acepta wa.me). Devuelve null si no parece un numero AR valido.
 */
export function normalizeArPhone(raw: string): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;

  if (d.startsWith('00')) d = d.slice(2);
  let mobile = false;

  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) {
      mobile = true;
      d = d.slice(1);
    }
  }
  if (d.startsWith('0')) d = d.slice(1);

  // Prefijo 15 de celular despues del codigo de area (2-4 digitos): 11 15 1234 5678.
  if (d.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (d.slice(areaLen, areaLen + 2) === '15') {
        d = d.slice(0, areaLen) + d.slice(areaLen + 2);
        mobile = true;
        break;
      }
    }
  }

  // Numero local CABA sin codigo de area (8 digitos, ej 4777-1234).
  if (d.length === 8 && /^[4-6]/.test(d)) d = `11${d}`;

  // Area + abonado siempre suman 10 digitos en Argentina.
  if (d.length !== 10) return null;
  if (!/^[1-9]/.test(d)) return null;
  return `+54${mobile ? '9' : ''}${d}`;
}

/** WhatsApp en AR siempre es celular: fuerza el 9 si viene sin el. */
function normalizeWhatsapp(raw: string): string | null {
  const n = normalizeArPhone(raw);
  if (n) return n.startsWith('+549') ? n : `+549${n.slice(3)}`;
  // Numeros extranjeros: los dejamos en E.164 tal cual.
  const d = raw.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 && !d.startsWith('54') ? `+${d}` : null;
}

// ---------------------------------------------------------------------------
// Extraccion desde HTML
// ---------------------------------------------------------------------------

// Busca el primer link IG plausible, excluyendo handles genericos de plataforma.
const IG_HANDLE_BLOCKLIST = new Set([
  'share',
  'explore',
  'reel',
  'reels',
  'tv',
  'p',
  'direct',
  'accounts',
  'developer',
  'about',
  'privacy',
]);

export function extractInstagramHandle(html: string): string | null {
  const regex = /instagram\.com\/([a-zA-Z0-9._]+)(?:[\/?#"'\s]|$)/g;
  let m: RegExpExecArray | null = regex.exec(html);
  while (m !== null) {
    const cand = m[1]?.toLowerCase();
    if (cand && !IG_HANDLE_BLOCKLIST.has(cand) && cand.length >= 2 && cand.length <= 30) {
      return cand;
    }
    m = regex.exec(html);
  }
  return null;
}

const PREFERRED_EMAIL_PREFIXES = [
  'info',
  'ventas',
  'hola',
  'comercial',
  'contacto',
  'contact',
  'hello',
  'administracion',
];

const EMAIL_BLOCKLIST =
  /(example\.|sentry|wixpress|godaddy|domain\.com|email\.com|yourdomain|tudominio|\.png$|\.jpe?g$|\.gif$|\.webp$|\.svg$)/i;

function emailDomainMatches(emailDomain: string, siteDomain: string | null): boolean {
  if (!siteDomain) return false;
  return emailDomain === siteDomain || emailDomain.endsWith(`.${siteDomain}`);
}

/** Elige el email generico preferido: dominio propio > mailto ajeno; info@/ventas@/hola@ primero. */
export function pickGenericEmail(
  candidates: Array<{ email: string; fromMailto: boolean }>,
  siteDomain: string | null,
): string | null {
  const valid = candidates.filter((c) => !EMAIL_BLOCKLIST.test(c.email));
  const ownDomain = valid.filter((c) =>
    emailDomainMatches(c.email.split('@')[1] ?? '', siteDomain),
  );
  // Fuera del dominio propio solo confiamos en mailto: (muchas pymes usan gmail).
  const pool = ownDomain.length > 0 ? ownDomain : valid.filter((c) => c.fromMailto);
  if (pool.length === 0) return null;

  const rank = (e: string) => {
    const local = e.split('@')[0] ?? '';
    const i = PREFERRED_EMAIL_PREFIXES.indexOf(local);
    return i === -1 ? PREFERRED_EMAIL_PREFIXES.length : i;
  };
  return pool.map((c) => c.email).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// Telefono AR en texto visible: (+54 9) (0)11|2xx|3xx (15) xxxx-xxxx.
const AR_PHONE_TEXT =
  /(?:\+?54[\s.-]?)?(?:9[\s.-]?)?\(?0?(?:11|[23]\d{2,3})\)?[\s.-]?(?:15[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b/g;

export function extractContactChannels(html: string, siteDomain: string | null): ContactChannels {
  const out: ContactChannels = {};
  const decoded = html.replace(/&amp;/g, '&').replace(/%2B/gi, '+');

  // WhatsApp: wa.me/<num>, api.whatsapp.com/send?phone=<num>, web.whatsapp.com/send?phone=<num>
  const waRegex =
    /(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\/?\?(?:[^"'\s]*&)?phone=)(\+?[\d\s-]{8,20})/gi;
  for (const m of decoded.matchAll(waRegex)) {
    const n = m[1] ? normalizeWhatsapp(m[1]) : null;
    if (n) {
      out.whatsapp = n;
      break;
    }
  }

  // Telefono: tel: primero (mas confiable), despues texto visible.
  for (const m of decoded.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const n = m[1] ? normalizeArPhone(decodeURIComponent(m[1])) : null;
    if (n) {
      out.phone = n;
      break;
    }
  }
  if (!out.phone) {
    const text = decoded
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    for (const m of text.matchAll(AR_PHONE_TEXT)) {
      const n = normalizeArPhone(m[0]);
      if (n) {
        out.phone = n;
        break;
      }
    }
  }

  const ig = extractInstagramHandle(decoded);
  if (ig) out.instagram_handle = ig;

  const candidates: Array<{ email: string; fromMailto: boolean }> = [];
  for (const m of decoded.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    if (m[1]) candidates.push({ email: decodeURIComponent(m[1]).toLowerCase(), fromMailto: true });
  }
  for (const m of decoded.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    candidates.push({ email: m[0].toLowerCase(), fromMailto: false });
  }
  const email = pickGenericEmail(candidates, siteDomain);
  if (email) out.generic_email = email;

  return out;
}

// ---------------------------------------------------------------------------
// Fetch del website
// ---------------------------------------------------------------------------

export function siteDomainOf(website: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct && !ct.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Scrapea home + /contacto + /contact en paralelo (timeout 5s c/u, ~5s total).
 * La home tiene prioridad; las paginas de contacto completan lo que falte.
 */
export async function scrapeContactChannels(website: string): Promise<ContactChannels> {
  if (!website || SOCIAL_DOMAINS.test(website)) return {};
  const base = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return {};
  }
  const domain = siteDomainOf(base);
  const pages = await Promise.all([
    fetchHtml(base),
    fetchHtml(`${origin}/contacto`),
    fetchHtml(`${origin}/contact`),
  ]);

  const merged: ContactChannels = {};
  for (const html of pages) {
    if (!html) continue;
    const found = extractContactChannels(html, domain);
    for (const k of Object.keys(found) as Array<keyof ContactChannels>) {
      if (!merged[k] && found[k]) merged[k] = found[k];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Google Maps fallback
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set([
  'sa',
  'srl',
  'sas',
  'sociedad',
  'anonima',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'the',
  'argentina',
  'arg',
]);

function nameTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/** Match razonable entre el nombre de la company y el titulo del lugar en Maps. */
export function titleMatches(companyName: string, placeTitle: string): boolean {
  const a = nameTokens(companyName);
  const b = nameTokens(placeTitle);
  if (a.length === 0 || b.length === 0) return false;
  const joinedA = a.join('');
  const joinedB = b.join('');
  if (joinedA.length >= 4 && (joinedB.includes(joinedA) || joinedA.includes(joinedB))) return true;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  return shared / Math.min(a.length, b.length) >= 0.6;
}

async function lookupMaps(
  db: DbClient,
  company: { name: string; region: string | null; venture: Venture },
): Promise<{ phone?: string; website?: string } | null> {
  const city = company.region || DEFAULT_CITY;
  const places = await apify.runGoogleMapsSearch({
    searchStringsArray: [`${company.name} ${city}`],
    maxCrawledPlacesPerSearch: 1,
    skipClosedPlaces: false,
  });
  await db.from('api_usage').insert({
    service: 'apify',
    operation: 'google-maps-contact-lookup',
    credits_used: Math.max(places.length, 1),
    tokens_used: null,
    venture: company.venture,
  });
  const place = places[0];
  if (!place || !titleMatches(company.name, place.title)) return null;
  const out: { phone?: string; website?: string } = {};
  const phone = place.phone ? normalizeArPhone(place.phone) : null;
  if (phone) out.phone = phone;
  if (place.website) out.website = place.website;
  return out;
}

// ---------------------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------------------

export interface EnrichContactChannelsOptions {
  ids?: string[];
  venture?: Venture;
  /** Max companies a scrapear (default 30). */
  limit?: number;
  /** Fallback Google Maps si falta telefono (default true). */
  maps?: boolean;
  /** Tope de busquedas Maps por corrida (default 10). */
  mapsLimit?: number;
  /** Re-procesar aunque enriched_at ya este seteado. */
  force?: boolean;
}

export interface EnrichContactChannelsResult {
  processed: number;
  updated: number;
  mapsLookups: number;
  pendingMaps: number;
  rows: Array<{ id: string; name: string; found: ContactChannels & { website?: string } }>;
}

type TargetRow = {
  id: string;
  name: string;
  venture: Venture;
  region: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram_handle: string | null;
  generic_email: string | null;
};

const TARGET_SELECT =
  'id, name, venture, region, website, phone, whatsapp, instagram_handle, generic_email';

async function loadTargets(db: DbClient, opts: EnrichContactChannelsOptions): Promise<TargetRow[]> {
  let q = db.from('companies').select(TARGET_SELECT);
  if (opts.ids && opts.ids.length > 0) {
    q = q.in('id', opts.ids);
  } else {
    q = q
      .in('stage', ['new', 'enriched', 'qualified', 'nurturing'])
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 30);
  }
  if (!opts.force) q = q.is('enriched_at', null);
  if (opts.venture) q = q.eq('venture', opts.venture);
  const { data, error } = await q;
  if (error) throw new Error(`load companies: ${error.message}`);
  return (data as unknown as TargetRow[]) ?? [];
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function enrichContactChannels(
  db: DbClient,
  opts: EnrichContactChannelsOptions = {},
): Promise<EnrichContactChannelsResult> {
  const log = createLogger('enrich-contact-channels');
  const useMaps = opts.maps ?? true;
  const mapsLimit = opts.mapsLimit ?? DEFAULT_MAPS_LIMIT;
  const targets = await loadTargets(db, opts);
  const result: EnrichContactChannelsResult = {
    processed: targets.length,
    updated: 0,
    mapsLookups: 0,
    pendingMaps: 0,
    rows: [],
  };
  if (targets.length === 0) return result;

  // 1) Scrape gratis en paralelo.
  const scraped = await mapLimit(targets, SCRAPE_CONCURRENCY, async (t) =>
    t.website ? scrapeContactChannels(t.website) : ({} as ContactChannels),
  );

  // 2) Maps para los que siguen sin telefono (tope por corrida), en paralelo.
  const needMaps = targets
    .map((t, idx) => ({ t, idx }))
    .filter(({ t, idx }) => !t.phone && !scraped[idx]?.phone);
  const mapsBatch = useMaps ? needMaps.slice(0, mapsLimit) : [];
  result.pendingMaps = needMaps.length - mapsBatch.length;
  const mapsAttempted = new Set<number>();
  const mapsFound = new Map<number, { phone?: string; website?: string }>();
  await Promise.all(
    mapsBatch.map(async ({ t, idx }) => {
      try {
        const r = await lookupMaps(db, t);
        mapsAttempted.add(idx);
        if (r) mapsFound.set(idx, r);
      } catch (err) {
        log.warn({ company: t.name, err: String(err) }, 'maps lookup failed');
      }
    }),
  );
  result.mapsLookups = mapsAttempted.size;

  // 3) Persistir: solo completa campos vacios, nunca pisa datos existentes.
  const now = new Date().toISOString();
  await Promise.all(
    targets.map(async (t, idx) => {
      const s = scraped[idx] ?? {};
      const m = mapsFound.get(idx) ?? {};
      const found: ContactChannels & { website?: string } = {};
      const update: Record<string, unknown> = {};
      const phone = s.phone ?? m.phone;
      if (!t.phone && phone) update.phone = found.phone = phone;
      if (!t.whatsapp && s.whatsapp) update.whatsapp = found.whatsapp = s.whatsapp;
      if (!t.instagram_handle && s.instagram_handle) {
        update.instagram_handle = found.instagram_handle = s.instagram_handle;
      }
      if (!t.generic_email && s.generic_email) {
        update.generic_email = found.generic_email = s.generic_email;
      }
      if (!t.website && m.website) update.website = found.website = m.website;

      // Terminado si ya hay telefono o ya se intento Maps; si no, queda para un pase con Maps.
      const done = Boolean(t.phone || phone) || mapsAttempted.has(idx);
      if (done) update.enriched_at = now;

      result.rows.push({ id: t.id, name: t.name, found });
      if (Object.keys(update).length === 0) return;
      const { error } = await db.from('companies').update(update).eq('id', t.id);
      if (error) {
        log.error({ company: t.name, err: error.message }, 'update failed');
        return;
      }
      if (Object.keys(found).length > 0) result.updated++;
    }),
  );

  log.info(
    {
      processed: result.processed,
      updated: result.updated,
      mapsLookups: result.mapsLookups,
      pendingMaps: result.pendingMaps,
    },
    'contact channels enrichment done',
  );
  return result;
}
