import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();
  const { data, error } = await db
    .from('companies')
    .update({ stage: 'meeting_booked', updated_at: new Date().toISOString() })
    .eq('name', 'Cafe Demo Palermo (test)')
    .select('id, name, stage');
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log('Updated:', JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
