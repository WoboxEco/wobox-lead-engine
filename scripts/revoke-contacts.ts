import { createAdminClient } from '@wobox/core';

async function main(): Promise<void> {
  const db = createAdminClient();

  // 1) Contar companies por source antes
  const { data: countBySource, error: groupErr } = await db
    .from('companies')
    .select('source')
    .limit(10000);
  if (groupErr) throw new Error(`select sources: ${groupErr.message}`);

  const tally: Record<string, number> = {};
  for (const r of (countBySource as Array<{ source: string | null }> | null) ?? []) {
    const k = r.source ?? '(null)';
    tally[k] = (tally[k] ?? 0) + 1;
  }
  console.log('companies por source ANTES:');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }

  // 2) DELETE companies WHERE source != 'web_search'.
  // Cascade borra contacts, scores, messages, interactions asociadas.
  const { error: delErr, count } = await db
    .from('companies')
    .delete({ count: 'exact' })
    .neq('source', 'web_search');
  if (delErr) throw new Error(`delete: ${delErr.message}`);
  console.log(`\ncompanies eliminadas: ${count}`);

  // 3) Tambien borrar las que tengan source NULL (raras, por las dudas)
  const { error: nullErr, count: nullCount } = await db
    .from('companies')
    .delete({ count: 'exact' })
    .is('source', null);
  if (nullErr) throw new Error(`delete nulls: ${nullErr.message}`);
  if ((nullCount ?? 0) > 0) console.log(`companies con source NULL eliminadas: ${nullCount}`);

  // 4) Verificar lo que queda
  const { data: after, count: afterCount } = await db
    .from('companies')
    .select('source', { count: 'exact' });
  const tallyAfter: Record<string, number> = {};
  for (const r of (after as Array<{ source: string | null }> | null) ?? []) {
    const k = r.source ?? '(null)';
    tallyAfter[k] = (tallyAfter[k] ?? 0) + 1;
  }
  console.log(`\ncompanies que QUEDAN: ${afterCount}`);
  for (const [k, v] of Object.entries(tallyAfter).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }

  // Counts por tabla relacionada (deberian haberse cascadeado)
  const tables = ['contacts', 'scores', 'messages', 'interactions'];
  console.log('\nrows restantes por tabla:');
  for (const t of tables) {
    const { count: c } = await db.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${t.padEnd(15)} ${c ?? '?'}`);
  }
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
