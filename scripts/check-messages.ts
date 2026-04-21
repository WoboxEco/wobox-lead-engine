import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('name', 'Cafe Demo Palermo (test)')
    .single();

  const { data: messages } = await db
    .from('messages')
    .select(
      'approach_type, channel, sequence_step, subject, body, prompt_version, status, created_at',
    )
    .eq('company_id', (company as { id: string }).id)
    .order('created_at', { ascending: false });

  console.log(JSON.stringify(messages, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
