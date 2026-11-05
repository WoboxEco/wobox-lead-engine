import { describe, expect, it, vi } from 'vitest';

vi.mock('@wobox/integrations', () => ({ apollo: {} }));

const { findRevealCandidates, NO_EMAIL_SOURCE } = await import('./reveal-email.js');

function fakeDb(companies: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'in']) q[m] = () => q;
  // biome-ignore lint/suspicious/noThenProperty: imita el query builder awaitable de supabase-js
  q.then = (r: (v: unknown) => unknown) =>
    Promise.resolve({ data: companies, error: null }).then(r);
  return { from: () => q } as never;
}

const companies = [
  {
    id: 'co1',
    name: 'Jackie Smith',
    apollo_id: 'org1',
    contacts: [
      {
        id: 'c1',
        name: 'Juan',
        email: null,
        is_decision_maker: true,
        contact_source: NO_EMAIL_SOURCE,
      },
    ],
  },
];

describe('findRevealCandidates: intento previo sin email', () => {
  it('por default saltea el contacto (no gasta créditos)', async () => {
    const r = await findRevealCandidates(fakeDb(companies), 'wobox_fashion', { force: true });
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toEqual([{ companyName: 'Jackie Smith', reason: 'apollo_sin_email_previo' }]);
  });
  it('con retryNoEmail lo reintenta', async () => {
    const r = await findRevealCandidates(fakeDb(companies), 'wobox_fashion', {
      force: true,
      retryNoEmail: true,
    });
    expect(r.candidates.map((c) => c.contactId)).toEqual(['c1']);
    expect(r.skipped).toEqual([]);
  });
});
