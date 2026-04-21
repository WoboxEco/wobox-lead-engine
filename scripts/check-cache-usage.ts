import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();
  const { data } = await db
    .from('api_usage')
    .select('operation, tokens_used, created_at')
    .eq('service', 'claude')
    .order('created_at', { ascending: false })
    .limit(35);

  type Row = { operation: string; tokens_used: number; created_at: string };
  const rows = (data as Row[]) ?? [];

  let totalWrites = 0;
  let totalReads = 0;
  let totalRegular = 0;
  let withCache = 0;
  let withoutCache = 0;

  for (const r of rows) {
    const cacheMatch = r.operation.match(/::cache=(\d+)\/(\d+)/);
    if (cacheMatch) {
      withCache += 1;
      const w = Number.parseInt(cacheMatch[1]!, 10);
      const rd = Number.parseInt(cacheMatch[2]!, 10);
      totalWrites += w;
      totalReads += rd;
      totalRegular += r.tokens_used - w - rd;
    } else {
      withoutCache += 1;
      totalRegular += r.tokens_used;
    }
  }

  console.log(`Ultimas ${rows.length} llamadas a Claude:`);
  console.log(`  con cache: ${withCache}`);
  console.log(`  sin cache: ${withoutCache}`);
  console.log();
  console.log('Tokens:');
  console.log(`  cache_creation (write): ${totalWrites}`);
  console.log(`  cache_read (hit):       ${totalReads}`);
  console.log(`  regular (input+output): ${totalRegular}`);
  console.log();
  if (totalReads > 0) {
    const hitRate = (withCache > 0 ? (totalReads / (totalReads + totalWrites)) * 100 : 0).toFixed(
      1,
    );
    console.log(`Cache hit ratio en tokens cacheables: ${hitRate}%`);
  }

  console.log('\nUltimas 5 operations:');
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.created_at}  ${r.operation}  (total=${r.tokens_used})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
