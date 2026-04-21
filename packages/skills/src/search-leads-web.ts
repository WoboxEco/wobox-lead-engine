import { createLogger } from '@wobox/core';

// Default: Haiku. El search en si es Apify (no Claude). Claude se usa solo para
// extraer/clasificar resultados ruidosos (sub-sector, decision maker en bio, etc).
export const DEFAULT_MODEL = 'haiku';

export interface SearchLeadsWebOptions {
  venture?: 'loop';
  subsector?: string;
  city?: string;
  neighborhood?: string;
  campaign?: string;
  model?: string;
}

export async function run(opts: SearchLeadsWebOptions): Promise<void> {
  const log = createLogger('search-leads-web');
  const model = opts.model ?? DEFAULT_MODEL;
  log.warn({ model }, 'stub: implement Apify + web flow');
  // TODO:
  // 1. Para cada sub-sector, lanzar Apify google-maps con queries especificas por barrio.
  // 2. Parsear resultados -> {name, address, website, phone, category, reviews}.
  // 3. Para cada uno: buscar Instagram handle (del website o via Google).
  // 4. Dedup + insert companies con source='web_search'.
  // 5. Asignar founder round-robin.
  // 6. Target: 40+ leads por corrida por sub-sector.
}
