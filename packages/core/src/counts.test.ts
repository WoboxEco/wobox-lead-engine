import { describe, expect, it } from 'vitest';
import { countRows, fetchAllRows, getPipelineCounts } from './counts.js';
import type { DbClient } from './db.js';

type Row = { id: number; stage: string; venture: string };

// Fake minimo del query builder de Supabase: soporta select(head count), eq y range,
// y respeta el limite de 1000 filas por request como PostgREST.
function fakeDb(rows: Row[]): { db: DbClient; requests: { n: number } } {
  const requests = { n: 0 };
  const db = {
    from: () => ({
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        const filters: Array<[keyof Row, unknown]> = [];
        let range: [number, number] = [0, 999];
        const builder = {
          eq(col: keyof Row, val: unknown) {
            filters.push([col, val]);
            return builder;
          },
          range(from: number, to: number) {
            range = [from, to];
            return builder;
          },
          // biome-ignore lint/suspicious/noThenProperty: fake thenable del query builder
          then(resolve: (v: unknown) => void) {
            requests.n++;
            const matched = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
            if (opts?.head) return resolve({ data: null, count: matched.length, error: null });
            const page = matched.slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
            return resolve({ data: page, count: null, error: null });
          },
        };
        return builder;
      },
    }),
  } as unknown as DbClient;
  return { db, requests };
}

function makeRows(): Row[] {
  const rows: Row[] = [];
  let id = 0;
  const push = (n: number, venture: string, stage: string) => {
    for (let i = 0; i < n; i++) rows.push({ id: id++, venture, stage });
  };
  push(3440, 'wobox_food', 'new');
  push(6, 'wobox_food', 'contacted');
  push(2, 'wobox_food', 'deal_ganado');
  push(45, 'wobox_fashion', 'qualified');
  push(50, 'loop', 'enriched');
  push(5, 'loop', 'discarded');
  return rows;
}

describe('getPipelineCounts', () => {
  it('cuenta mas alla del limite de 1000 filas de Supabase', async () => {
    const { db } = fakeDb(makeRows());
    const c = await getPipelineCounts(db);
    expect(c.total).toBe(3548);
    expect(c.active).toBe(3543);
    expect(c.byStage.contacted).toBe(6);
    expect(c.byStage.deal_ganado).toBe(2);
    expect(c.byStage.discarded).toBe(5);
    expect(c.byVenture).toEqual({ wobox_food: 3448, wobox_fashion: 45, loop: 55 });
  });
});

describe('fetchAllRows', () => {
  it('pagina con range hasta traer todo', async () => {
    const { db, requests } = fakeDb(makeRows());
    const all = await fetchAllRows<Row>((from, to) =>
      db.from('companies').select('*').eq('venture', 'wobox_food').range(from, to),
    );
    expect(all).toHaveLength(3448);
    expect(new Set(all.map((r) => r.id)).size).toBe(3448);
    expect(requests.n).toBe(4);
  });

  it('propaga errores', async () => {
    await expect(
      fetchAllRows(async () => ({ data: null, error: { message: 'boom' } })),
    ).rejects.toThrow('boom');
  });
});

describe('countRows', () => {
  it('null => 0', async () => {
    expect(await countRows(Promise.resolve({ count: null, error: null }))).toBe(0);
  });
});
