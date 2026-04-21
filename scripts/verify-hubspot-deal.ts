import { createAdminClient, env } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();
  const token = env().HUBSPOT_PRIVATE_APP_TOKEN;

  const { data: company } = await db
    .from('companies')
    .select('id, name, hubspot_deal_id, hubspot_id, stage')
    .eq('name', 'Cafe Demo Palermo (test)')
    .single();

  console.log('--- Company en Supabase ---');
  console.log(JSON.stringify(company, null, 2));

  const dealId = (company as { hubspot_deal_id: string }).hubspot_deal_id;

  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,venture,pipeline,dealstage,amount&associations=contacts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const deal = (await res.json()) as Record<string, unknown>;

  console.log('\n--- Deal en HubSpot ---');
  console.log(JSON.stringify(deal, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
