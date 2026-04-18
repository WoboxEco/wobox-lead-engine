import { createLogger } from '@wobox/core';

export interface ShowMetricsOptions {
  venture?: string;
  period?: string;
}

export async function run(_opts: ShowMetricsOptions): Promise<void> {
  const log = createLogger('show-metrics');
  log.warn('stub: implement KPIs por venture + buyer persona + approach + channel');
}
