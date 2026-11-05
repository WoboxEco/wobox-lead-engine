/**
 * Opciones y resumen de "+ Prospect" (search-leads + scoring).
 * Funciones puras y sin dependencias de servidor: las usa el cliente del dashboard
 * (`@wobox/skills/prospect-summary`).
 */

/** Regiones del selector del dashboard. `value` va tal cual a Apollo `organization_locations`. */
export const PROSPECT_REGIONS = [
  { value: 'Argentina', label: 'Argentina' },
  { value: 'Ciudad Autónoma de Buenos Aires, Argentina', label: 'CABA' },
  { value: 'Buenos Aires, Argentina', label: 'Buenos Aires' },
  { value: 'Córdoba, Argentina', label: 'Córdoba' },
  { value: 'Rosario, Argentina', label: 'Rosario' },
  { value: 'Mendoza, Argentina', label: 'Mendoza' },
] as const;

export type ProspectRegion = (typeof PROSPECT_REGIONS)[number]['value'];

export function isProspectRegion(value: string): value is ProspectRegion {
  return PROSPECT_REGIONS.some((r) => r.value === value);
}

/** Resultado estructurado de search-leads (Apollo). */
export interface SearchLeadsResult {
  inserted: number;
  duplicates: number;
  /** Páginas de Apollo pedidas en esta corrida (1 crédito c/u). */
  pagesFetched: number;
  /** Última página pedida (o la que tocaba si no se pidió ninguna). */
  page: number;
  totalPages: number | null;
  credits: number;
  /** No quedan más páginas para este venture + filtros. */
  exhausted: boolean;
  contactsAdded: number;
  /** IDs de las companies insertadas (para scorearlas en otra llamada). */
  insertedIds: string[];
}

export const EXHAUSTED_MESSAGE =
  'Se agotaron los resultados para este filtro: probá otro rubro o región';

/**
 * "X nuevos, Y duplicados, Z calificados — página N de M (K créditos)".
 * `qualified` null = scoring no corrió (o falló), se omite ese tramo.
 */
export function formatProspectSummary(r: SearchLeadsResult, qualified: number | null): string {
  const parts = [`${r.inserted} nuevos`, `${r.duplicates} duplicados`];
  if (qualified !== null) parts.push(`${qualified} calificados`);
  const pageText = r.totalPages ? `página ${r.page} de ${r.totalPages}` : `página ${r.page}`;
  const credits = `${r.credits} ${r.credits === 1 ? 'crédito' : 'créditos'}`;
  const summary = `${parts.join(', ')} — ${pageText} (${credits})`;
  return r.exhausted ? `${summary}. ${EXHAUSTED_MESSAGE}` : summary;
}
