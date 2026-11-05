/**
 * Genera drafts de email wobox_fashion de punta a punta con los prompts REALES
 * (packages/prompts/messages/*.md) y Claude + Supabase mockeados, para los 3 approaches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY ??= 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service';
  return {
    companies: [] as Array<Record<string, unknown>>,
    inserted: [] as Array<Record<string, unknown>>,
    errorLogs: [] as Array<Record<string, unknown>>,
    claudeCalls: [] as Array<{ system: string; user: string; operation: string }>,
    claudeImpl: null as null | ((p: { user: string }) => Promise<string>),
  };
});

/** Query builder mínimo de supabase-js: encadenable y awaitable. */
function query(table: string) {
  let payload: Record<string, unknown> | null = null;
  let ids: string[] | null = null;
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'update']) b[m] = () => b;
  b.in = (col: string, vals: string[]) => {
    if (col === 'id') ids = vals;
    return b;
  };
  b.insert = (row: Record<string, unknown>) => {
    payload = row;
    return b;
  };
  b.single = async () => {
    if (table === 'messages' && payload) {
      state.inserted.push(payload);
      return { data: { id: `msg-${state.inserted.length}` }, error: null };
    }
    return { data: null, error: { message: 'not found' } };
  };
  // biome-ignore lint/suspicious/noThenProperty: imita el query builder awaitable de supabase-js
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    let data: unknown = [];
    if (table === 'companies')
      data = ids ? state.companies.filter((c) => ids!.includes(c.id as string)) : state.companies;
    if (table === 'error_logs' && payload) state.errorLogs.push(payload);
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  };
  return b;
}

vi.mock('@wobox/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wobox/core')>()),
  createAdminClient: () => ({ from: (t: string) => query(t) }),
}));

vi.mock('@wobox/integrations', () => ({
  claude: {
    completeText: async (p: { system: string; user: string; operation: string }) => {
      state.claudeCalls.push(p);
      if (state.claudeImpl) return state.claudeImpl(p);
      return 'SUBJECT: Flash sale de fiestas\n\nBODY: Hola Rosa, ...\n\nSebastián, Wobox';
    },
  },
}));

const { run, formatFailures } = await import('./generate-messages.js');

function jackieSmith(warmPath: 'none' | 'direct' = 'none') {
  return {
    id: 'co-jackie',
    name: 'Jackie Smith',
    venture: 'wobox_fashion',
    vertical: 'fashion',
    subsector: 'calzado',
    locations_count: 12,
    region: 'CABA',
    instagram_handle: 'jackiesmith',
    contacts: [
      { id: 'ct-sin-email', name: 'Juan Perez', is_decision_maker: true, email: null },
      {
        id: 'ct-jl',
        name: 'Jorgelina Lozzia',
        role: 'Gerente Comercial',
        email: 'jlozzia@jackiesmith.com.ar',
        warm_path: warmPath,
        warm_connector: warmPath === 'direct' ? 'Ana Gómez' : undefined,
      },
    ],
    scores: [
      {
        total_score: 72,
        scoring_model: 'x',
        ai_reasoning: 'Calzado con temporadas',
        scored_at: '2026-10-01',
      },
    ],
  };
}

beforeEach(() => {
  state.companies = [];
  state.inserted = [];
  state.errorLogs = [];
  state.claudeCalls = [];
  state.claudeImpl = null;
});

describe('generate-messages: email wobox_fashion con prompts reales', () => {
  it.each([
    ['direct', 'message-wobox-direct-fashion-v1', null],
    ['nurture', 'message-wobox-nurture-fashion-v1', 4],
    ['warm_intro', 'message-wobox-warm-intro-fashion-v1', null],
  ] as const)('approach=%s → %s', async (approach, promptName, step) => {
    state.companies = [jackieSmith(approach === 'warm_intro' ? 'direct' : 'none')];
    const r = await run({
      all: true,
      venture: 'wobox_fashion',
      channel: 'email',
      requireEmail: true,
      force: true,
      approach,
    });

    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({ ok: 1, failed: 0, noEmail: 0 });
    expect(state.claudeCalls).toHaveLength(1);
    const call = state.claudeCalls[0]!;
    expect(call.operation).toBe(`generate-${promptName}`);
    expect(call.user).toContain('Jackie Smith');
    expect(call.user).toContain('Jorgelina Lozzia');
    expect(call.user).not.toMatch(/\{\{\w+\}\}/);
    if (approach === 'warm_intro') expect(call.user).toContain('Ana Gómez');
    expect(call.system).toContain('SUBJECT:');

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      contact_id: 'ct-jl',
      company_id: 'co-jackie',
      approach_type: approach,
      channel: 'email',
      sequence_step: step,
      subject: 'Flash sale de fiestas',
      prompt_version: promptName,
      status: 'draft',
    });
  });

  it('approach automático: sin warm path → direct, con warm path → warm_intro', async () => {
    state.companies = [
      jackieSmith('none'),
      { ...jackieSmith('direct'), id: 'co-2', name: 'Amphora Argentina SA' },
    ];
    const r = await run({
      all: true,
      venture: 'wobox_fashion',
      channel: 'email',
      requireEmail: true,
    });
    expect(r.ok).toBe(2);
    expect(state.inserted.map((m) => m.prompt_version)).toEqual([
      'message-wobox-direct-fashion-v1',
      'message-wobox-warm-intro-fashion-v1',
    ]);
  });

  it('planOnly no llama a Claude y devuelve las companies pendientes; ids restringe el lote', async () => {
    state.companies = [
      jackieSmith(),
      { ...jackieSmith(), id: 'co-2', name: 'Amphora Argentina SA' },
    ];
    const plan = await run({
      all: true,
      venture: 'wobox_fashion',
      channel: 'email',
      requireEmail: true,
      force: true,
      planOnly: true,
    });
    expect(plan.pending).toEqual(['co-jackie', 'co-2']);
    expect(state.claudeCalls).toHaveLength(0);

    const r = await run({
      all: true,
      venture: 'wobox_fashion',
      channel: 'email',
      requireEmail: true,
      force: true,
      ids: ['co-2'],
    });
    expect(r.ok).toBe(1);
    expect(state.inserted[0]).toMatchObject({ company_id: 'co-2' });
  });

  it('un fallo queda en failures con el motivo y en error_logs con contexto', async () => {
    state.companies = [
      jackieSmith(),
      { ...jackieSmith(), id: 'co-2', name: 'Amphora Argentina SA' },
    ];
    state.claudeImpl = async () => {
      throw new Error('404 model: claude-x not found');
    };
    const r = await run({
      all: true,
      venture: 'wobox_fashion',
      channel: 'email',
      requireEmail: true,
    });
    expect(r).toMatchObject({ ok: 0, failed: 2 });
    expect(r.failures.map((f) => f.company)).toEqual(['Jackie Smith', 'Amphora Argentina SA']);
    expect(formatFailures(r.failures)).toBe('2 fallaron: 404 model: claude-x not found');
    expect(state.errorLogs).toHaveLength(2);
    expect(state.errorLogs[0]).toMatchObject({
      skill: 'generate-messages',
      company_id: 'co-jackie',
      error_message: '404 model: claude-x not found',
      context: expect.objectContaining({
        venture: 'wobox_fashion',
        channel: 'email',
        approach: 'direct',
        promptName: 'message-wobox-direct-fashion-v1',
        contactId: 'ct-jl',
        stage: 'claude',
        company: 'Jackie Smith',
      }),
    });
  });
});
