import { createLogger } from '@wobox/core';

export interface EnrichLeadOptions {
  id?: string;
  all?: boolean;
}

export async function run(_opts: EnrichLeadOptions): Promise<void> {
  const log = createLogger('enrich-lead');
  log.warn('stub: implement Instagram + web enrichment via Apify');
  // TODO:
  // 1. Para cada company sin enriquecer: visitar website, extraer IG handle.
  // 2. Llamar apify.getInstagramProfile(handle) -> followers, posts recientes.
  // 3. Actualizar social_followers, social_source, instagram_handle.
  // 4. Transicion stage new -> enriched.
}
