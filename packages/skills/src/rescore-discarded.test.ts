import { describe, expect, it, vi } from 'vitest';

vi.mock('@wobox/core', () => ({
  createAdminClient: () => ({}),
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  fetchAllRows: async () => [],
  scoringModelForVenture: () => 'scoring-wobox-fashion-v2',
}));
vi.mock('./score-leads.js', () => ({ run: async () => ({}) }));

const { selectRescoreCandidates } = await import('./rescore-discarded.js');

const s = (total_score: number, scored_at: string, scoring_model = 'scoring-wobox-fashion-v1') => ({
  total_score,
  scored_at,
  scoring_model,
});

describe('selectRescoreCandidates', () => {
  const opts = { min: 35, max: 49, currentModel: 'scoring-wobox-fashion-v2' };

  it('usa el último score y respeta el rango', () => {
    const ids = selectRescoreCandidates(
      [
        { id: 'a', scores: [s(42, '2026-10-01')] },
        { id: 'b', scores: [s(20, '2026-10-01')] },
        { id: 'c', scores: [s(55, '2026-09-01'), s(49, '2026-10-01')] },
        { id: 'd', scores: [s(42, '2026-09-01'), s(30, '2026-10-01')] },
        { id: 'e', scores: [] },
        { id: 'f', scores: [s(35, '2026-10-01')] },
      ],
      opts,
    );
    expect(ids).toEqual(['a', 'c', 'f']);
  });

  it('no repite los que ya se re-puntuaron con el modelo vigente', () => {
    const ids = selectRescoreCandidates(
      [{ id: 'a', scores: [s(42, '2026-10-01'), s(45, '2026-11-01', 'scoring-wobox-fashion-v2')] }],
      opts,
    );
    expect(ids).toEqual([]);
  });
});
