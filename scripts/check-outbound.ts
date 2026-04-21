import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: company } = await db
    .from('companies')
    .select('id, name, stage, buyer_persona')
    .eq('name', 'Cafe Demo Palermo (test)')
    .single();

  const companyRow = company as { id: string; name: string; stage: string; buyer_persona: string };
  console.log('--- COMPANY ---');
  console.log(JSON.stringify(companyRow, null, 2));

  const { data: messages } = await db
    .from('messages')
    .select('id, approach_type, channel, status, sent_at, body, original_body')
    .eq('company_id', companyRow.id)
    .order('created_at', { ascending: false });

  console.log('\n--- MESSAGES ---');
  for (const m of (messages as Array<Record<string, unknown>>) ?? []) {
    const edited = m.body !== m.original_body ? ' EDITED' : '';
    console.log(
      `  [${m.status}]${edited} ${m.approach_type} ${m.channel} sent_at=${m.sent_at ?? '-'}`,
    );
  }

  const { data: interactions } = await db
    .from('interactions')
    .select('type, channel, outcome, ai_generated, performed_at, content')
    .eq('company_id', companyRow.id)
    .order('performed_at', { ascending: false });

  console.log('\n--- INTERACTIONS ---');
  for (const i of (interactions as Array<Record<string, unknown>>) ?? []) {
    const preview = String(i.content).slice(0, 80);
    console.log(`  ${i.type} via ${i.channel} | outcome=${i.outcome} | ai=${i.ai_generated}`);
    console.log(`    "${preview}..."`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
