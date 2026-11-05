import type { DbClient } from './db.js';
import { DEAL_STAGES, STAGES, VENTURES } from './domain.js';

/**
 * IMPORTANTE: PostgREST/Supabase devuelve como maximo 1000 filas por request
 * (`max-rows`). Un `select()` sin `.range()` NO trae "todas las filas": se corta
 * en 1000 en silencio. Por eso:
 *
 * - Para CONTAR: usar `countRows()` con `select('id', { count: 'exact', head: true })`.
 *   No transfiere filas y el count es exacto.
 * - Para TRAER TODO (p.ej. dedup): usar `fetchAllRows()`, que pagina con `.range()`.
 */

export const SUPABASE_PAGE_SIZE = 1000;

// `data` es unknown a proposito: los builders de Supabase infieren tipos que no matchean
// el T del caller; el caller declara la forma de la fila con el generico.
type QueryResult = { data: unknown; error: { message: string } | null };
type CountResult = { count: number | null; error: { message: string } | null };

/**
 * Pagina con `.range(from, to)` hasta traer todas las filas.
 * `buildQuery` debe devolver una query NUEVA cada vez (con orden estable, idealmente
 * `.order('id')`) y aplicar el rango recibido.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<QueryResult>,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(`fetchAllRows: ${error.message}`);
    const rows = (data as T[] | null) ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/** Resuelve una query `{ count: 'exact', head: true }` a un numero (0 si viene null). */
export async function countRows(query: PromiseLike<CountResult>): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`countRows: ${error.message}`);
  return count ?? 0;
}

export interface PipelineCounts {
  total: number;
  /** total - discarded */
  active: number;
  byStage: Record<string, number>;
  byVenture: Record<string, number>;
}

/**
 * Counts del pipeline de companies (home "/"). Una query head-count por stage
 * (incluye deal_*), por venture y una por el total, todas en paralelo.
 */
export async function getPipelineCounts(db: DbClient): Promise<PipelineCounts> {
  const head = () => db.from('companies').select('id', { count: 'exact', head: true });
  const stages = [...STAGES, ...DEAL_STAGES];

  const [total, stageCounts, ventureCounts] = await Promise.all([
    countRows(head()),
    Promise.all(stages.map((s) => countRows(head().eq('stage', s)))),
    Promise.all(VENTURES.map((v) => countRows(head().eq('venture', v)))),
  ]);

  const byStage = Object.fromEntries(stages.map((s, i) => [s, stageCounts[i] ?? 0]));
  const byVenture = Object.fromEntries(VENTURES.map((v, i) => [v, ventureCounts[i] ?? 0]));
  return { total, active: total - (byStage.discarded ?? 0), byStage, byVenture };
}
