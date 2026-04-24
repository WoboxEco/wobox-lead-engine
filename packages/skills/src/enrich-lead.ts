import { type DbClient, createAdminClient, createLogger } from '@wobox/core';
import { apify } from '@wobox/integrations';

export interface EnrichLeadOptions {
  id?: string;
  all?: boolean;
  limit?: number;
  venture?: string;
  force?: boolean;
  noScrape?: boolean;
}

type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  instagram_handle: string | null;
  social_followers: number | null;
  social_source: string | null;
  stage: string;
};

export async function run(opts: EnrichLeadOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('enrich-lead');

  const companies = await loadTargets(db, opts);
  if (companies.length === 0) {
    console.log('No hay companies para enriquecer');
    return;
  }

  const { resolved, skipped } = await resolveHandles(companies, {
    scrape: !opts.noScrape,
    log,
  });
  if (resolved.length === 0) {
    console.log(`Sin handles IG resolvibles (${skipped.length} skipped):`);
    for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
    return;
  }

  log.info({ count: resolved.length }, 'consultando Apify Instagram scraper');
  const handles = resolved.map((r) => r.handle);
  const profiles = await apify.getInstagramProfiles(handles).catch((err) => {
    log.error({ err: String(err) }, 'apify instagram fetch failed');
    return [];
  });

  const byHandle = new Map(profiles.map((p) => [p.username.toLowerCase(), p]));

  let updated = 0;
  let notFound = 0;

  for (const t of resolved) {
    const profile = byHandle.get(t.handle.toLowerCase());
    if (!profile) {
      console.log(`[${t.company.name}] handle=${t.handle} NO ENCONTRADO`);
      notFound++;
      continue;
    }

    const update: Record<string, unknown> = {
      instagram_handle: t.handle,
      social_followers: profile.followersCount ?? null,
      social_source: 'instagram',
    };

    // Si no tenemos website y Apify nos da externalUrl, guardarlo.
    if (!t.company.website && profile.externalUrl) {
      update.website = profile.externalUrl;
    }

    // Transicion new -> enriched (solo si sigue en new, no pisar qualified/etc).
    if (t.company.stage === 'new') {
      update.stage = 'enriched';
    }

    const { error } = await db.from('companies').update(update).eq('id', t.company.id);
    if (error) {
      log.error({ err: error.message, company: t.company.name }, 'update failed');
      continue;
    }

    updated++;
    console.log(
      `[${t.company.name}] @${t.handle} followers=${profile.followersCount ?? '?'} posts=${profile.postsCount ?? '?'}${update.website ? ` +website=${update.website}` : ''}`,
    );
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} skipped:`);
    for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
  }

  console.log(`\nResumen: updated=${updated}, notFound=${notFound}, skipped=${skipped.length}`);
}

async function loadTargets(db: DbClient, opts: EnrichLeadOptions): Promise<CompanyRow[]> {
  if (opts.id) {
    const { data, error } = await db
      .from('companies')
      .select('id, name, website, instagram_handle, social_followers, social_source, stage')
      .eq('id', opts.id)
      .single();
    if (error || !data) throw new Error(`company ${opts.id} no existe`);
    return [data as unknown as CompanyRow];
  }

  const limit = opts.limit ?? 30;
  let q = db
    .from('companies')
    .select('id, name, website, instagram_handle, social_followers, social_source, stage')
    .limit(limit);

  if (opts.venture) q = q.eq('venture', opts.venture);

  if (opts.force) {
    // Rescan: cualquier stage con handle o website IG.
    q = q.in('stage', ['new', 'enriched', 'qualified', 'nurturing']);
  } else {
    // Default: stage new o sin followers.
    q = q.in('stage', ['new']);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = ((data as unknown as CompanyRow[]) ?? []).filter((r) =>
    opts.force ? true : r.social_followers === null,
  );
  return rows;
}

interface ResolvedTarget {
  company: CompanyRow;
  handle: string;
}

interface SkippedTarget {
  name: string;
  reason: string;
}

async function resolveHandles(
  companies: CompanyRow[],
  opts: { scrape: boolean; log: ReturnType<typeof createLogger> },
): Promise<{ resolved: ResolvedTarget[]; skipped: SkippedTarget[] }> {
  const resolved: ResolvedTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const c of companies) {
    let handle: string | null = null;

    if (c.instagram_handle) {
      handle = apify.normalizeInstagramHandle(c.instagram_handle);
    }
    if (!handle && c.website && /instagram\.com/i.test(c.website)) {
      handle = apify.normalizeInstagramHandle(c.website);
    }

    // Scrape HTML del website si tenemos dominio real (no IG) y scrape activo.
    if (
      !handle &&
      opts.scrape &&
      c.website &&
      !/(instagram|facebook|tiktok|twitter|x|linkedin)\.com/i.test(c.website)
    ) {
      handle = await scrapeInstagramFromWebsite(c.website, opts.log);
    }

    if (!handle) {
      skipped.push({
        name: c.name,
        reason: c.website ? `website sin IG link detectable (${c.website})` : 'sin instagram_handle y sin website',
      });
      continue;
    }

    resolved.push({ company: c, handle });
  }

  return { resolved, skipped };
}

const SCRAPE_TIMEOUT_MS = 8000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function scrapeInstagramFromWebsite(
  website: string,
  log: ReturnType<typeof createLogger>,
): Promise<string | null> {
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
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
    if (!res.ok) {
      log.debug({ website, status: res.status }, 'scrape non-2xx');
      return null;
    }
    const html = await res.text();
    return extractInstagramHandle(html);
  } catch (err) {
    log.debug({ website, err: String(err) }, 'scrape failed');
    return null;
  } finally {
    clearTimeout(t);
  }
}

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
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const cand = m[1]?.toLowerCase();
    if (!cand) continue;
    if (IG_HANDLE_BLOCKLIST.has(cand)) continue;
    if (cand.length < 2 || cand.length > 30) continue;
    if (seen.has(cand)) continue;
    seen.add(cand);
    return cand;
  }
  return null;
}
