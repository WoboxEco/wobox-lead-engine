import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: rows } = await db
    .from('companies')
    .select(
      'id, name, buyer_persona, neighborhood, instagram_handle, scores(total_score, ai_reasoning, scored_at)',
    )
    .eq('venture', 'loop')
    .order('name');

  type Row = {
    id: string;
    name: string;
    buyer_persona?: string;
    neighborhood?: string;
    instagram_handle?: string;
    scores: Array<{ total_score: number; ai_reasoning: string; scored_at: string }>;
  };

  const pipeline = ((rows as unknown as Row[]) ?? []).map((r) => {
    const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
    return { ...r, score: latest?.total_score ?? null };
  });

  pipeline.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const hot = pipeline.filter((r) => (r.score ?? 0) >= 80);
  const warm = pipeline.filter((r) => (r.score ?? 0) >= 50 && (r.score ?? 0) < 80);
  const cold = pipeline.filter((r) => (r.score ?? 0) < 50 && r.score !== null);

  console.log(`--- DISTRIBUCION (total ${pipeline.length}) ---`);
  console.log(`HOT  (80+): ${hot.length}`);
  console.log(`WARM (50-79): ${warm.length}`);
  console.log(`COLD (<50): ${cold.length}\n`);

  console.log('--- HOT LEADS (contactar directo) ---');
  for (const r of hot) {
    console.log(`  ${r.score} | ${r.buyer_persona ?? '-'} | ${r.name} | ${r.neighborhood ?? '-'}`);
  }

  console.log('\n--- WARM LEADS (nurture) ---');
  for (const r of warm) {
    console.log(`  ${r.score} | ${r.buyer_persona ?? '-'} | ${r.name} | ${r.neighborhood ?? '-'}`);
  }

  if (cold.length > 0) {
    console.log('\n--- COLD LEADS (reactivar en 6 meses) ---');
    for (const r of cold) {
      console.log(`  ${r.score} | ${r.buyer_persona ?? '-'} | ${r.name}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
