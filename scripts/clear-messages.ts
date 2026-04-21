import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();
  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('name', 'Cafe Demo Palermo (test)')
    .single();
  const { error, count } = await db
    .from('messages')
    .delete({ count: 'exact' })
    .eq('company_id', (company as { id: string }).id);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log('Deleted messages:', count);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
