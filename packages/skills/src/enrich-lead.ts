import { type DbClient, createAdminClient, createLogger } from '@wobox/core';
import { apify } from '@wobox/integrations';
import { enrichContactChannels } from './scrape-contact-channels.js';

export interface EnrichLeadOptions {
  id?: string;
  all?: boolean;
  limit?: number;
  venture?: string;
  force?: boolean;
  noScrape?: boolean;
  /** commander: --no-scrape => scrape=false */
  scrape?: boolean;
  /** commander: --no-maps => maps=false */
  maps?: boolean;
  mapsLimit?: number;
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

  // Canales de contacto (website scrape gratis + Maps si falta telefono). Tambien
  // completa instagram_handle desde el website, asi que despues no re-scrapeamos.
  const scrape = !opts.noScrape && opts.scrape !== false;
  if (scrape) {
    const channels = await enrichContactChannels(db, {
      ids: companies.map((c) => c.id),
      maps: opts.maps !== false,
      ...(opts.mapsLimit ? { mapsLimit: opts.mapsLimit } : {}),
      ...(opts.force ? { force: true } : {}),
    });
    const byId = new Map(channels.rows.map((r) => [r.id, r.found]));
    for (const c of companies) {
      const found = byId.get(c.id);
      if (!found || Object.keys(found).length === 0) continue;
      if (found.instagram_handle && !c.instagram_handle)
        c.instagram_handle = found.instagram_handle;
      if (found.website && !c.website) c.website = found.website;
      console.log(`[${c.name}] canales: ${JSON.stringify(found)}`);
    }
    console.log(
      `Canales: ${channels.updated}/${channels.processed} con datos nuevos, ${channels.mapsLookups} busquedas Maps${channels.pendingMaps ? ` (${channels.pendingMaps} pendientes por tope)` : ''}\n`,
    );
  }

  // El scrape de IG desde el website ya lo hizo enrichContactChannels.
  const { resolved, skipped } = await resolveHandles(companies);
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

    if (!handle) {
      skipped.push({
        name: c.name,
        reason: c.website
          ? `website sin IG link detectable (${c.website})`
          : 'sin instagram_handle y sin website',
      });
      continue;
    }

    resolved.push({ company: c, handle });
  }

  return { resolved, skipped };
}

// Re-export para compatibilidad (tests y consumidores existentes).
export { extractInstagramHandle } from './scrape-contact-channels.js';
