import { createAdminClient } from '../packages/core/src/index.js';

async function main() {
  const db = createAdminClient();

  const { data: rows } = await db
    .from('companies')
    .select(
      'id, name, neighborhood, instagram_handle, scores(total_score, scoring_model, scored_at)',
    )
    .eq('venture', 'loop');

  type Row = {
    id: string;
    name: string;
    neighborhood?: string;
    instagram_handle?: string;
    scores: Array<{ total_score: number; scoring_model: string; scored_at: string }>;
  };

  const items = ((rows as unknown as Row[]) ?? []).map((r) => {
    const sorted = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at));
    // First Sonnet score and first Haiku score after rescore.
    // After rescore with Sonnet, sonnet scores are on top.
    let sonnetScore: number | null = null;
    let haikuScore: number | null = null;
    for (const s of sorted) {
      // operation prefix not visible here; infer by scored_at + which came first
      // simpler: we ran Haiku first, then Sonnet; so earliest = haiku, latest = sonnet.
    }
    // sorted[0] = most recent = Sonnet, sorted.at(-1) = oldest = Haiku (or first score)
    sonnetScore = sorted[0]?.total_score ?? null;
    haikuScore = sorted.length > 1 ? sorted[sorted.length - 1]!.total_score : null;
    return {
      name: r.name,
      neighborhood: r.neighborhood,
      ig: r.instagram_handle,
      haiku: haikuScore,
      sonnet: sonnetScore,
      delta: sonnetScore !== null && haikuScore !== null ? sonnetScore - haikuScore : null,
    };
  });

  items.sort((a, b) => (b.sonnet ?? 0) - (a.sonnet ?? 0));

  console.log('NAME'.padEnd(55), 'HAIKU', 'SONNET', 'DELTA', 'IG');
  console.log('-'.repeat(100));
  for (const i of items) {
    console.log(
      (i.name ?? '').slice(0, 54).padEnd(55),
      String(i.haiku ?? '-').padStart(5),
      String(i.sonnet ?? '-').padStart(6),
      String(i.delta ?? '-').padStart(5),
      i.ig ?? '-',
    );
  }

  const sonnetRange = {
    hot: items.filter((i) => (i.sonnet ?? 0) >= 80).length,
    warm: items.filter((i) => (i.sonnet ?? 0) >= 50 && (i.sonnet ?? 0) < 80).length,
    cold: items.filter((i) => (i.sonnet ?? 0) < 50).length,
  };
  const haikuRange = {
    hot: items.filter((i) => (i.haiku ?? 0) >= 80).length,
    warm: items.filter((i) => (i.haiku ?? 0) >= 50 && (i.haiku ?? 0) < 80).length,
    cold: items.filter((i) => (i.haiku ?? 0) < 50).length,
  };

  console.log('\n--- DISTRIBUCION ---');
  console.log('HAIKU :  hot', haikuRange.hot, ' warm', haikuRange.warm, ' cold', haikuRange.cold);
  console.log(
    'SONNET:  hot',
    sonnetRange.hot,
    ' warm',
    sonnetRange.warm,
    ' cold',
    sonnetRange.cold,
  );

  const haikuScores = items.map((i) => i.haiku).filter((s): s is number => s !== null);
  const sonnetScores = items.map((i) => i.sonnet).filter((s): s is number => s !== null);
  const stddev = (arr: number[]) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  };
  const range = (arr: number[]) => `${Math.min(...arr)} - ${Math.max(...arr)}`;
  console.log('\n--- DISPERSION ---');
  console.log(`HAIKU : rango ${range(haikuScores)}, stddev ${stddev(haikuScores).toFixed(1)}`);
  console.log(`SONNET: rango ${range(sonnetScores)}, stddev ${stddev(sonnetScores).toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
