import { type Venture, createAdminClient } from '@wobox/core';
import { scoreLeads, searchLeads, searchLeadsWeb } from '@wobox/skills';
import { type SearchLeadsResult, isProspectRegion } from '@wobox/skills/prospect-summary';
import { revalidatePath } from 'next/cache';

/**
 * Lógica server-side de "+ Prospect", llamada desde las API routes `/api/prospect` (sourcing)
 * y `/api/score-leads` (scoring por lotes). Van por API routes (no server actions) y separadas
 * para no pasar el timeout de Vercel Hobby: el cliente encadena sourcing → lotes de scoring.
 */

const VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);
const FASHION_SUBSECTORS = new Set(['ropa', 'calzado', 'muebles_deco', 'todos']);

/** Máximo de companies por request de scoring (Claude ~2-4s c/u). */
export const MAX_SCORE_IDS_PER_REQUEST = 3;

/** Después de este tiempo search-leads no pide otra página de Apollo (deja margen a inserts). */
const SOURCING_TIME_BUDGET_MS = 6_000;

export interface ProspectSourcingResponse {
  venture: Venture;
  /** null para loop (Apify, sin resultado estructurado). */
  search: SearchLeadsResult | null;
  /** Companies a scorear en lotes desde el cliente. */
  toScore: string[];
}

export function validateVenture(raw: unknown): Venture | null {
  const v = String(raw ?? '') as Venture;
  return VENTURES.has(v) ? v : null;
}

export async function runProspectSourcing(input: {
  venture?: unknown;
  limit?: unknown;
  subsector?: unknown;
  region?: unknown;
}): Promise<ProspectSourcingResponse | { error: string }> {
  const venture = validateVenture(input.venture);
  if (!venture) return { error: 'Venture inválido' };
  const limitRaw = Number.parseInt(String(input.limit ?? '25'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 25;

  const subsectorRaw = String(input.subsector ?? '').trim();
  let subsector: string | undefined;
  if (venture === 'wobox_fashion' && subsectorRaw) {
    if (!FASHION_SUBSECTORS.has(subsectorRaw)) return { error: 'Rubro inválido' };
    subsector = subsectorRaw;
  }
  const regionRaw = String(input.region ?? '').trim();
  let region: string | undefined;
  if (venture !== 'loop' && regionRaw) {
    if (!isProspectRegion(regionRaw)) return { error: 'Región inválida' };
    region = regionRaw;
  }

  let search: SearchLeadsResult | null = null;
  try {
    if (venture === 'loop') {
      await searchLeadsWeb.run({ limit: String(limit) });
    } else {
      search = await searchLeads.run({
        venture,
        limit: String(limit),
        timeBudgetMs: SOURCING_TIME_BUDGET_MS,
        ...(subsector ? { subsector } : {}),
        ...(region ? { region } : {}),
      });
    }
  } catch (e) {
    return { error: `Error en sourcing: ${String(e).slice(0, 200)}` };
  }

  revalidatePath('/pipeline');
  revalidatePath('/');

  // Apollo: solo lo recién insertado. Loop: los pendientes de scoring del venture (como antes).
  let toScore: string[] = search?.insertedIds ?? [];
  if (!search) {
    const db = createAdminClient();
    const { data } = await db
      .from('companies')
      .select('id')
      .eq('venture', venture)
      .in('stage', ['new', 'enriched'])
      .order('created_at', { ascending: false })
      .limit(limit);
    toScore = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  return { venture, search, toScore };
}

export async function runProspectScoring(input: {
  venture?: unknown;
  ids?: unknown;
}): Promise<scoreLeads.ScoreLeadsResult | { error: string }> {
  const venture = validateVenture(input.venture);
  if (!venture) return { error: 'Venture inválido' };
  if (
    !Array.isArray(input.ids) ||
    input.ids.length === 0 ||
    input.ids.length > MAX_SCORE_IDS_PER_REQUEST ||
    !input.ids.every((id) => typeof id === 'string')
  ) {
    return { error: `ids inválidos (1 a ${MAX_SCORE_IDS_PER_REQUEST})` };
  }
  try {
    const r = await scoreLeads.run({ venture, ids: input.ids as string[] });
    revalidatePath('/pipeline');
    revalidatePath('/');
    return r;
  } catch (e) {
    return { error: `Error en scoring: ${String(e).slice(0, 200)}` };
  }
}
