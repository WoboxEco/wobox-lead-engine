import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();
  const tables = [
    'companies',
    'contacts',
    'scores',
    'interactions',
    'messages',
    'campaigns',
    'error_logs',
    'api_usage',
  ] as const;

  for (const t of tables) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
    console.log(error ? `${t}: ERROR ${error.message}` : `${t}: ${count} rows`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
