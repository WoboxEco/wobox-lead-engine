import { createLogger } from '@wobox/core';

export interface ImportCsvOptions {
  file?: string;
  venture?: string;
}

export async function run(_opts: ImportCsvOptions): Promise<void> {
  const log = createLogger('import-csv');
  log.warn('stub: implement CSV import');
  // TODO: parsear CSV, validar columnas, dedup, insert companies/contacts.
}
