import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: company } = await db
    .from('companies')
    .select('id, name, stage, buyer_persona, subsector, region')
    .eq('name', 'Cafe Demo Palermo (test)')
    .single();

  console.log('--- COMPANY ---');
  console.log(JSON.stringify(company, null, 2));

  const { data: scores } = await db
    .from('scores')
    .select(
      'total_score, scoring_model, dimensions, buyer_persona_assigned, ai_reasoning, scored_at',
    )
    .eq('company_id', (company as { id: string }).id)
    .order('scored_at', { ascending: false });

  console.log('\n--- SCORES ---');
  console.log(JSON.stringify(scores, null, 2));

  const { data: usage } = await db
    .from('api_usage')
    .select('service, operation, tokens_used, venture, created_at')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('\n--- API USAGE ---');
  console.log(JSON.stringify(usage, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
