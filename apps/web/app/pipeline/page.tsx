import { createAdminClient } from '@wobox/core';
import { changeStage, discardCompany } from './actions';

export const dynamic = 'force-dynamic';

const ALL_STAGES = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture);
  const stage = pickString(params.stage);
  const minScore = pickString(params.min);

  const db = createAdminClient();

  let q = db
    .from('companies')
    .select(
      'id, name, venture, stage, vertical, subsector, buyer_persona, region, neighborhood, instagram_handle, social_followers, scores(total_score, scored_at), contacts(name, role, warm_path)',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (venture) q = q.eq('venture', venture);
  if (stage) q = q.eq('stage', stage);

  const { data, error } = await q;

  if (error) {
    return <p className="subtitle">Error: {error.message}</p>;
  }

  type Row = {
    id: string;
    name: string;
    venture: string;
    stage: string;
    vertical: string | null;
    subsector: string | null;
    buyer_persona: string | null;
    region: string | null;
    neighborhood: string | null;
    instagram_handle: string | null;
    social_followers: number | null;
    scores: Array<{ total_score: number; scored_at: string }>;
    contacts: Array<{ name: string; role: string | null; warm_path: string | null }>;
  };

  const minScoreNum = minScore ? Number(minScore) : null;

  let rows = ((data as unknown as Row[]) ?? []).map((r) => {
    const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
    const warm = r.contacts.find(
      (c) => c.warm_path === 'direct' || c.warm_path === '2nd_degree',
    );
    return {
      ...r,
      score: latest?.total_score ?? null,
      warm: warm
        ? `${warm.warm_path === 'direct' ? 'DIRECT' : '2nd'} via ${warm.name}`
        : null,
    };
  });

  if (minScoreNum !== null) rows = rows.filter((r) => (r.score ?? -1) >= minScoreNum);
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <>
      <h1>Pipeline</h1>
      <p className="subtitle">
        {rows.length} companies
        {venture && ` · venture=${venture}`}
        {stage && ` · stage=${stage}`}
        {minScoreNum !== null && ` · score>=${minScoreNum}`}
      </p>

      <form method="get" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select name="venture" defaultValue={venture ?? ''}>
          <option value="">— venture —</option>
          <option value="wobox_food">wobox_food</option>
          <option value="wobox_fashion">wobox_fashion</option>
          <option value="loop">loop</option>
        </select>
        <select name="stage" defaultValue={stage ?? ''}>
          <option value="">— stage —</option>
          <option value="new">new</option>
          <option value="enriched">enriched</option>
          <option value="qualified">qualified</option>
          <option value="nurturing">nurturing</option>
          <option value="contacted">contacted</option>
          <option value="meeting_booked">meeting_booked</option>
          <option value="discarded">discarded</option>
        </select>
        <input
          name="min"
          type="number"
          placeholder="min score"
          defaultValue={minScore ?? ''}
          style={{ width: 100 }}
        />
        <button type="submit">Filtrar</button>
        <a href="/pipeline" style={{ alignSelf: 'center' }}>reset</a>
      </form>

      {rows.length === 0 ? (
        <p className="empty">Sin resultados</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Name</th>
              <th>Stage</th>
              <th>Venture / BP</th>
              <th>Region</th>
              <th>IG</th>
              <th>Warm path</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={scoreClass(r.score)}>{r.score ?? '-'}</td>
                <td>{r.name}</td>
                <td>
                  <span className={`pill stage-${r.stage}`}>{r.stage.replace('_', ' ')}</span>
                </td>
                <td>
                  {r.venture}
                  {r.buyer_persona ? ` · ${r.buyer_persona}` : ''}
                </td>
                <td>{[r.neighborhood, r.region].filter(Boolean).join(', ') || '-'}</td>
                <td>
                  {r.instagram_handle ? `@${r.instagram_handle}` : '-'}
                  {r.social_followers ? ` · ${formatFollowers(r.social_followers)}` : ''}
                </td>
                <td>{r.warm ?? '-'}</td>
                <td>
                  <form
                    action={changeStage}
                    style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <select name="stage" defaultValue={r.stage} style={{ fontSize: 12, padding: '2px 4px' }}>
                      {ALL_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        background: '#036',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      OK
                    </button>
                  </form>
                  {r.stage !== 'discarded' ? (
                    <form action={discardCompany} style={{ display: 'inline', marginLeft: 6 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          background: '#fff',
                          color: '#900',
                          border: '1px solid #900',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        descartar
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function scoreClass(s: number | null): string {
  if (s === null) return '';
  if (s >= 80) return 'score-high';
  if (s >= 60) return 'score-mid';
  return 'score-low';
}

function formatFollowers(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
