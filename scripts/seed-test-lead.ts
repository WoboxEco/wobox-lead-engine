import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const testName = 'Cafe Demo Palermo (test)';

  // Idempotente: borrar si ya existe de una corrida anterior.
  await db.from('companies').delete().eq('name', testName);

  const { data, error } = await db
    .from('companies')
    .insert({
      name: testName,
      venture: 'loop',
      subsector: 'cafeteria',
      locations_count: 2,
      is_franchise: false,
      franchise_type: 'not_franchise',
      region: 'CABA',
      neighborhood: 'Palermo Soho',
      social_followers: 15000,
      social_source: 'instagram',
      instagram_handle: 'cafedemopalermo',
      digital_readiness: 'high',
      recurrence_potential: 'high',
      stage: 'new',
      source: 'manual',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Insert failed:', error.message);
    process.exit(1);
  }

  console.log('Inserted test company. UUID:', (data as { id: string }).id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
