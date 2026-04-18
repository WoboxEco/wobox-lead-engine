import { createLogger } from '@wobox/core';

export async function run(): Promise<void> {
  const log = createLogger('nurture-sequence');
  log.warn('stub: procesa la vista nurture_today y genera messages draft para cada touchpoint');
}
