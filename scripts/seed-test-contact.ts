import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('name', 'Cafe Demo Palermo (test)')
    .single();

  if (!company) {
    console.error('Test company no encontrada. Corre seed-test-lead.ts primero.');
    process.exit(1);
  }

  const companyId = (company as { id: string }).id;

  // Idempotente.
  await db.from('contacts').delete().eq('company_id', companyId);

  const { data, error } = await db
    .from('contacts')
    .insert({
      company_id: companyId,
      name: 'Martina Alvarez',
      role: 'Co-fundadora',
      email: 'martina@cafedemopalermo.ar',
      instagram_url: 'https://instagram.com/cafedemopalermo',
      is_decision_maker: true,
      warm_path: 'none',
      contact_source: 'IG bio',
    })
    .select('id')
    .single();

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.log('Contact UUID:', (data as { id: string }).id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
