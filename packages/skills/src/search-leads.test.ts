import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fakes de DB y Apollo ---------------------------------------------------------------

type Row = Record<string, unknown>;

const state = {
  cursor: null as Row | null,
  existing: [] as Row[],
  inserted: [] as Row[],
  upserts: [] as Row[],
  apolloPages: {} as Record<number, Array<{ id: string; name: string }>>,
  totalPages: 1,
  apolloCalls: [] as number[],
};

function makeDb() {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          table === 'sourcing_cursors' ? { data: state.cursor, error: null } : { data: null },
        insert(row: Row | Row[]) {
          if (table === 'companies') {
            const id = `c-${state.inserted.length + 1}`;
            state.inserted.push({ ...(row as Row), id });
            return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
          }
          return Promise.resolve({ error: null });
        },
        upsert: async (row: Row) => {
          state.upserts.push(row);
          return { error: null };
        },
      };
      return q;
    },
  };
}

vi.mock('@wobox/core', () => ({
  createAdminClient: () => makeDb(),
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  fetchAllRows: async () => state.existing,
  writeErrorLog: async () => {},
}));

vi.mock('@wobox/integrations', () => ({
  apollo: {
    searchOrganizations: async ({ page }: { page: number }) => {
      state.apolloCalls.push(page);
      return {
        organizations: state.apolloPages[page] ?? [],
        page,
        totalPages: state.totalPages,
        totalEntries: 0,
      };
    },
    searchDecisionMakers: async () => [],
  },
}));

const { run, buildCursorFilters, hashFilters } = await import('./search-leads.js');

const org = (n: number) => ({ id: `o${n}`, name: `Org ${n}` });

beforeEach(() => {
  state.cursor = null;
  state.existing = [];
  state.inserted = [];
  state.upserts = [];
  state.apolloPages = {};
  state.totalPages = 10;
  state.apolloCalls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('search-leads paginación', () => {
  it('arranca en next_page del cursor y lo avanza', async () => {
    state.cursor = { next_page: 4, total_pages: 10 };
    state.apolloPages[4] = [org(1), org(2)];
    const r = await run({ venture: 'wobox_fashion' });
    expect(state.apolloCalls).toEqual([4]);
    expect(r).toMatchObject({ inserted: 2, duplicates: 0, page: 4, totalPages: 10, credits: 1 });
    expect(r.exhausted).toBe(false);
    expect(r.insertedIds).toEqual(['c-1', 'c-2']);
    expect(state.upserts[0]).toMatchObject({ next_page: 5, total_pages: 10 });
  });

  it('si la página trae solo duplicados pasa a la siguiente (máx 3)', async () => {
    state.existing = [{ name: 'Org 1' }, { name: 'Org 2' }, { name: 'Org 3' }];
    state.apolloPages = { 1: [org(1)], 2: [org(2)], 3: [org(3)], 4: [org(4)] };
    const r = await run({ venture: 'wobox_fashion' });
    expect(state.apolloCalls).toEqual([1, 2, 3]);
    expect(r).toMatchObject({ inserted: 0, duplicates: 3, pagesFetched: 3, credits: 3, page: 3 });
    expect(state.upserts[0]).toMatchObject({ next_page: 4 });
  });

  it('corta apenas una página trae nuevos', async () => {
    state.existing = [{ name: 'Org 1' }];
    state.apolloPages = { 1: [org(1)], 2: [org(2)], 3: [org(3)] };
    const r = await run({ venture: 'wobox_fashion' });
    expect(state.apolloCalls).toEqual([1, 2]);
    expect(r).toMatchObject({ inserted: 1, duplicates: 1, credits: 2 });
  });

  it('marca agotado al pasar total_pages', async () => {
    state.totalPages = 2;
    state.existing = [{ name: 'Org 1' }, { name: 'Org 2' }];
    state.apolloPages = { 1: [org(1)], 2: [org(2)] };
    const r = await run({ venture: 'wobox_fashion' });
    expect(state.apolloCalls).toEqual([1, 2]);
    expect(r.exhausted).toBe(true);
    expect(state.upserts[0]).toMatchObject({ next_page: 3, total_pages: 2 });
  });

  it('cursor ya agotado: no llama a Apollo (0 créditos)', async () => {
    state.cursor = { next_page: 3, total_pages: 2 };
    const r = await run({ venture: 'wobox_fashion' });
    expect(state.apolloCalls).toEqual([]);
    expect(r).toMatchObject({ exhausted: true, credits: 0, inserted: 0 });
    expect(state.upserts).toEqual([]);
  });

  it('dry-run: una sola página y no guarda cursor', async () => {
    state.existing = [{ name: 'Org 1' }];
    state.apolloPages = { 1: [org(1)], 2: [org(2)] };
    const r = await run({ venture: 'wobox_fashion', dryRun: true });
    expect(state.apolloCalls).toEqual([1]);
    expect(r.credits).toBe(1);
    expect(state.upserts).toEqual([]);
    expect(state.inserted).toEqual([]);
  });

  it('pasa region a Apollo como location y cambia el hash', async () => {
    state.apolloPages[1] = [org(1)];
    await run({ venture: 'wobox_fashion', region: 'Córdoba, Argentina' });
    const withRegion = state.upserts[0]?.filters_hash;
    state.upserts = [];
    await run({ venture: 'wobox_fashion' });
    expect(state.upserts[0]?.filters_hash).not.toBe(withRegion);
  });
});

describe('hashFilters', () => {
  const base = {
    venture: 'wobox_fashion',
    subsector: null,
    industries: ['footwear', 'apparel'],
    keywords: 'moda  calzado',
    employeeRanges: ['11,50'],
    locations: ['Argentina'],
  };

  it('es estable ante orden de arrays, mayúsculas y espacios', () => {
    const a = hashFilters(buildCursorFilters(base));
    const b = hashFilters(
      buildCursorFilters({
        ...base,
        industries: ['Apparel', 'footwear'],
        keywords: 'Moda calzado',
      }),
    );
    expect(a).toBe(b);
  });

  it('subsector "todos" equivale a sin subsector', () => {
    expect(hashFilters(buildCursorFilters({ ...base, subsector: 'todos' }))).toBe(
      hashFilters(buildCursorFilters(base)),
    );
  });

  it('cambia con la región', () => {
    expect(
      hashFilters(buildCursorFilters({ ...base, locations: ['Mendoza, Argentina'] })),
    ).not.toBe(hashFilters(buildCursorFilters(base)));
  });
});
