import { type Venture, createAdminClient } from '@wobox/core';
import { enrichContactChannels } from './scrape-contact-channels.js';

export interface EnrichContactsOptions {
  id?: string;
  venture?: string;
  limit?: number;
  /** commander: --no-maps => maps=false */
  maps?: boolean;
  mapsLimit?: number;
  force?: boolean;
}

/** CLI: canales de contacto (telefono, WhatsApp, IG, email generico) a nivel company. */
export async function run(opts: EnrichContactsOptions): Promise<void> {
  const db = createAdminClient();
  const res = await enrichContactChannels(db, {
    ...(opts.id ? { ids: [opts.id] } : {}),
    ...(opts.venture ? { venture: opts.venture as Venture } : {}),
    ...(opts.limit ? { limit: opts.limit } : {}),
    maps: opts.maps !== false,
    ...(opts.mapsLimit ? { mapsLimit: opts.mapsLimit } : {}),
    ...(opts.force ? { force: true } : {}),
  });
  if (res.processed === 0) {
    console.log('No hay companies pendientes de enriquecer (usar --force para re-procesar)');
    return;
  }
  for (const r of res.rows) {
    const found = Object.entries(r.found)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`[${r.name}] ${found || 'sin datos nuevos'}`);
  }
  console.log(
    `\nResumen: processed=${res.processed}, updated=${res.updated}, maps=${res.mapsLookups}, pendientesMaps=${res.pendingMaps}`,
  );
}
