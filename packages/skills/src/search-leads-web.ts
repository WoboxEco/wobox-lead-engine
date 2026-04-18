import { createLogger } from '@wobox/core';

export interface SearchLeadsWebOptions {
  venture?: 'loop';
  subsector?: string;
  city?: string;
  neighborhood?: string;
  campaign?: string;
}

export async function run(_opts: SearchLeadsWebOptions): Promise<void> {
  const log = createLogger('search-leads-web');
  log.warn('stub: implement Apify + web flow');
  // TODO:
  // 1. Para cada sub-sector, lanzar Apify google-maps con queries especificas por barrio.
  // 2. Parsear resultados -> {name, address, website, phone, category, reviews}.
  // 3. Para cada uno: buscar Instagram handle (del website o via Google).
  // 4. Dedup + insert companies con source='web_search'.
  // 5. Asignar founder round-robin.
  // 6. Target: 40+ leads por corrida por sub-sector.
}
