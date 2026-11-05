import { createAdminClient } from '@wobox/core';
import { History } from 'lucide-react';

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

type CursorRow = {
  venture: string;
  filters: { subsector?: string | null; locations?: string[] | null } | null;
  next_page: number | null;
  total_pages: number | null;
  updated_at: string | null;
};

/**
 * "Últimas búsquedas": lee `sourcing_cursors` (cursor de paginación Apollo por filtros) para que
 * el historial de +Prospect sobreviva al refresh. Solo muestra página/fecha: la tabla no guarda
 * el resumen (nuevos/duplicados/créditos) de cada corrida.
 */
export async function RecentSearches() {
  const db = createAdminClient();
  const { data, error } = await db
    .from('sourcing_cursors')
    .select('venture, filters, next_page, total_pages, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);

  // Ej: migration 0010 sin aplicar → no rompemos /pipeline, solo ocultamos la sección.
  if (error) return null;
  const rows = (data ?? []) as CursorRow[];

  return (
    <div className="surface p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <History size={14} className="text-muted" />
        <h2 className="text-[13px] font-semibold">Últimas búsquedas</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">Todavía no hay búsquedas con Apollo.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => {
            const subsector = r.filters?.subsector;
            const locations = r.filters?.locations ?? [];
            const consumed = Math.max(0, (r.next_page ?? 1) - 1);
            const exhausted = r.total_pages !== null && consumed >= r.total_pages;
            return (
              <li
                key={`${r.venture}-${r.updated_at}-${subsector ?? ''}-${locations.join(',')}`}
                className="text-[12.5px] text-muted-strong flex flex-wrap gap-x-2"
              >
                <span className="font-medium">{VENTURE_LABELS[r.venture] ?? r.venture}</span>
                {subsector ? <span>· {subsector}</span> : null}
                {locations.length ? <span>· {locations.join(', ')}</span> : null}
                <span className="font-mono">
                  · página {consumed}
                  {r.total_pages !== null ? ` de ${r.total_pages}` : ''}
                  {exhausted ? ' (agotado)' : ''}
                </span>
                {r.updated_at ? (
                  <span className="text-muted">· {formatDate(r.updated_at)}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
