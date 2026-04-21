import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminClient, createLogger } from '@wobox/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

export async function run(): Promise<void> {
  const log = createLogger('setup-database');
  const db = createAdminClient();

  log.info({ path: MIGRATIONS_DIR }, 'reading migrations');
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
  }

  log.info({ count: files.length, files }, 'running migrations');

  for (const file of files) {
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf-8');
    log.info({ file }, 'applying migration');

    const { error } = await db.rpc('exec_sql', { sql });
    if (error) {
      // Si exec_sql todavía no existe (primera corrida), el primer migration lo crea.
      // Fallback: intentar via postgres-meta no es posible desde supabase-js.
      // Instrucción para el usuario: crear exec_sql manualmente la primera vez.
      if (error.message.includes('function') && error.message.includes('exec_sql')) {
        throw new Error(
          'La funcion exec_sql no existe en tu Supabase. Correr este SQL una vez desde el SQL Editor del dashboard:\n\n' +
            'CREATE OR REPLACE FUNCTION exec_sql(sql text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE sql; END; $$;\n\n' +
            "Despues reintentar 'pnpm skill setup-database'.",
        );
      }
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }

    log.info({ file }, 'migration applied');
  }

  log.info({ applied: files.length }, 'all migrations applied');
  log.info(
    'Siguiente paso: ejecutar `pnpm db:types` para regenerar packages/core/src/database.types.ts',
  );
}
