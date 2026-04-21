import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();
  const { data, error } = await db
    .from('error_logs')
    .select('skill, error_type, error_message, company_id, context, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
