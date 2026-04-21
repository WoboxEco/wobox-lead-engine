import { createLogger } from '@wobox/core';

// Default: Haiku. Enrichment = extraccion de datos estructurados (handle IG, rol,
// ciudad) desde paginas/bios. Tarea mecanica, Haiku suficiente.
export const DEFAULT_MODEL = 'haiku';

export interface EnrichLeadOptions {
  id?: string;
  all?: boolean;
  model?: string;
}

export async function run(opts: EnrichLeadOptions): Promise<void> {
  const log = createLogger('enrich-lead');
  const model = opts.model ?? DEFAULT_MODEL;
  log.warn({ model }, 'stub: implement Instagram + web enrichment via Apify');
  // TODO:
  // 1. Para cada company sin enriquecer: visitar website, extraer IG handle.
  // 2. Llamar apify.getInstagramProfile(handle) -> followers, posts recientes.
  // 3. Actualizar social_followers, social_source, instagram_handle.
  // 4. Transicion stage new -> enriched.
}
