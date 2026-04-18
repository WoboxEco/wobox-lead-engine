import { createLogger } from '@wobox/core';

export interface FullProspectingOptions {
  venture?: string;
  subsector?: string;
  region?: string;
  campaign?: string;
}

export async function run(_opts: FullProspectingOptions): Promise<void> {
  const log = createLogger('full-prospecting');
  log.warn('stub: orchestrate search -> enrich -> score -> check-warm-path -> generate-messages');
  // TODO: encadenar skills y resumir por venture.
}
