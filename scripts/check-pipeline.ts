import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: pipeline } = await db
    .from('companies')
    .select('name, venture, subsector, neighborhood, website, instagram_handle, stage')
    .eq('venture', 'loop')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log(`--- LOOP COMPANIES (${pipeline?.length ?? 0}) ---`);
  for (const c of pipeline ?? []) {
    const r = c as Record<string, unknown>;
    console.log(
      `[${r.stage}] ${r.name} | ${r.neighborhood ?? '-'} | ig: ${r.instagram_handle ?? '-'} | web: ${r.website ? 'yes' : 'no'}`,
    );
  }

  const { data: usage } = await db
    .from('api_usage')
    .select('service, operation, credits_used, tokens_used, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n--- RECENT API USAGE ---');
  console.log(JSON.stringify(usage, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
