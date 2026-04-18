import { createLogger } from '@wobox/core';

export interface SearchLeadsOptions {
  venture?: string;
  vertical?: string;
  region?: string;
  minSize?: string;
  campaign?: string;
}

export async function run(_opts: SearchLeadsOptions): Promise<void> {
  const log = createLogger('search-leads');
  log.warn('stub: implement Apollo search flow');
  // TODO:
  // 1. Validar venture (wobox_food | wobox_fashion | loop-cadenas BP1 16+/BP6).
  // 2. Llamar apollo.searchOrganizations con filtros.
  // 3. Dedup por linkedin_url > website > instagram_handle > name+region.
  // 4. Insert companies + contacts.
  // 5. Asignar founder (warm > round-robin).
  // 6. Track creditos en api_usage.
}
