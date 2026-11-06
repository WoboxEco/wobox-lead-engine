import { createAdminClient } from '@wobox/core';
import { ArrowDown, ArrowUp, AtSign, Filter, MapPin, X } from 'lucide-react';
import Link from 'next/link';
import { changeStage, discardCompany } from './actions';
import { UnlockButton } from './unlock-button';

import { ProspectBar } from './prospect-bar';
import { RecentSearches } from './recent-searches';
import { VentureSelect } from './venture-select';

export const dynamic = 'force-dynamic';

// Leads Engine: solo stages de prospeccion. Los deal_* stages viven en /crm —
// separacion por stage, no por tabla (ver domain.ts STAGES vs DEAL_STAGES).
const ALL_STAGES = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
];

// Opcion extra solo en el selector de fila: graduar un meeting_booked al CRM.
const HANDOFF_STAGE = 'deal_sin_contacto';

const STAGE_LABELS: Record<string, string> = {
  new: 'new',
  enriched: 'enriched',
  qualified: 'qualified',
  nurturing: 'nurturing',
  contacted: 'contacted',
  meeting_booked: 'meeting',
  discarded: 'discarded',
  deal_sin_contacto: '→ pasar a CRM',
};

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture);
  const stage = pickString(params.stage);
  const minScore = pickString(params.min);
  // Orden de la tabla: por defecto los leads más nuevos primero.
  const sort: SortKey = params.sort === 'score' ? 'score' : 'alta';
  const dir: SortDir = params.dir === 'asc' ? 'asc' : 'desc';

  const db = createAdminClient();

  let q = db
    .from('companies')
    .select(
      'id, name, venture, stage, created_at, vertical, subsector, buyer_persona, region, neighborhood, instagram_handle, social_followers, scores(total_score, scored_at), contacts(id, name, role, email, linkedin_url, warm_path, is_decision_maker)',
    )
    // Con orden por alta ascendente traemos los 200 más viejos; en el resto, los 200 más nuevos.
    .order('created_at', { ascending: sort === 'alta' && dir === 'asc' })
    .limit(200);
  if (venture) q = q.eq('venture', venture);
  if (stage) {
    q = q.eq('stage', stage);
  } else {
    // Sin filtro explicito: no mezclar companies que ya graduaron al CRM (deal_* stages).
    q = q.in('stage', ALL_STAGES);
  }

  const { data, error } = await q;

  if (error) {
    return <p className="text-muted">Error: {error.message}</p>;
  }

  type Row = {
    id: string;
    name: string;
    venture: string;
    stage: string;
    created_at: string;
    vertical: string | null;
    subsector: string | null;
    buyer_persona: string | null;
    region: string | null;
    neighborhood: string | null;
    instagram_handle: string | null;
    social_followers: number | null;
    scores: Array<{ total_score: number; scored_at: string }>;
    contacts: Array<{
      id: string;
      name: string;
      role: string | null;
      email: string | null;
      linkedin_url: string | null;
      warm_path: string | null;
      is_decision_maker: boolean | null;
    }>;
  };

  const minScoreNum = minScore ? Number(minScore) : null;

  let rows = ((data as unknown as Row[]) ?? []).map((r) => {
    const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
    const warm = r.contacts.find((c) => c.warm_path === 'direct' || c.warm_path === '2nd_degree');
    return {
      ...r,
      score: latest?.total_score ?? null,
      warm: warm ? `${warm.warm_path === 'direct' ? 'DIRECT' : '2nd'} via ${warm.name}` : null,
    };
  });

  if (minScoreNum !== null) rows = rows.filter((r) => (r.score ?? -1) >= minScoreNum);
  const sign = dir === 'asc' ? 1 : -1;
  if (sort === 'score') {
    rows.sort((a, b) => sign * ((a.score ?? -1) - (b.score ?? -1)));
  } else {
    rows.sort((a, b) => sign * a.created_at.localeCompare(b.created_at));
  }

  // Link de cabecera ordenable: conserva los filtros y alterna asc/desc sobre la columna activa.
  const sortHref = (key: SortKey) => {
    const qs = new URLSearchParams();
    if (venture) qs.set('venture', venture);
    if (stage) qs.set('stage', stage);
    if (minScore) qs.set('min', minScore);
    const nextDir: SortDir = sort === key ? (dir === 'desc' ? 'asc' : 'desc') : 'desc';
    if (key !== 'alta') qs.set('sort', key);
    if (nextDir !== 'desc') qs.set('dir', nextDir);
    const q = qs.toString();
    return q ? `/pipeline?${q}` : '/pipeline';
  };
  const sortHeader = (key: SortKey, label: string) => (
    <Link
      href={sortHref(key)}
      className={`inline-flex items-center gap-1 hover:text-[var(--foreground)] transition-colors ${sort === key ? 'text-[var(--foreground)]' : ''}`}
    >
      {label}
      {sort === key ? dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : null}
    </Link>
  );

  const hasFilters = !!(venture || stage || minScoreNum !== null);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1">Pipeline</p>
        <h1 className="text-3xl font-semibold tracking-tight">Companies</h1>
        <p className="text-muted mt-1.5 text-[13.5px]">
          {rows.length} resultados
          {venture && ` · ${VENTURE_LABELS[venture] ?? venture}`}
          {stage && ` · ${STAGE_LABELS[stage] ?? stage}`}
          {minScoreNum !== null && ` · score >= ${minScoreNum}`}
        </p>
      </div>

      {/* Acciones: +Prospect (sourcing+scoring) y Generar mensajes */}
      <ProspectBar defaultVenture={venture ?? ''} />
      <RecentSearches />

      {/* Filtros */}
      <form method="get" className="surface p-4">
        {/* Mantiene el orden elegido al aplicar filtros */}
        {sort !== 'alta' ? <input type="hidden" name="sort" value={sort} /> : null}
        {dir !== 'desc' ? <input type="hidden" name="dir" value={dir} /> : null}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-muted shrink-0" />
          <select
            name="venture"
            defaultValue={venture ?? ''}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
          >
            <option value="">Todos los ventures</option>
            <option value="wobox_food">Wobox Food</option>
            <option value="wobox_fashion">Wobox Fashion</option>
            <option value="loop">Loop</option>
          </select>
          <select
            name="stage"
            defaultValue={stage ?? ''}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
          >
            <option value="">Todos los stages</option>
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          <input
            name="min"
            type="number"
            placeholder="Min score"
            defaultValue={minScore ?? ''}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px] w-28 focus:outline-none focus:border-[var(--border-strong)]"
          />
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            Filtrar
          </button>
          {hasFilters ? (
            <Link
              href="/pipeline"
              className="text-muted hover:text-[var(--foreground)] text-[12.5px] flex items-center gap-1 transition-colors"
            >
              <X size={13} /> reset
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-muted">Sin resultados.</p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted border-b border-[var(--border)]">
                  <th className="py-3 px-4 w-[60px]">{sortHeader('score', 'Score')}</th>
                  <th className="py-3 px-4 whitespace-nowrap">{sortHeader('alta', 'Alta')}</th>
                  <th className="py-3 px-4">Company</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4">Venture · BP</th>
                  <th className="py-3 px-4">Ubicacion</th>
                  <th className="py-3 px-4">Instagram</th>
                  <th className="py-3 px-4 w-[220px]">Contactos</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-elevated)] transition-colors"
                  >
                    <td className={`py-3 px-4 tabular-nums ${scoreClass(r.score)}`}>
                      {r.score ?? '-'}
                    </td>
                    <td className="py-3 px-4 text-muted-strong tabular-nums whitespace-nowrap">
                      {formatAlta(r.created_at)}
                    </td>
                    <td className="py-3 px-4 font-medium">{r.name}</td>
                    <td className="py-3 px-4">
                      <span className={`pill stage-${r.stage}`}>
                        {STAGE_LABELS[r.stage] ?? r.stage.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-strong">
                      <VentureSelect companyId={r.id} defaultValue={r.venture} />
                      {r.buyer_persona ? (
                        <span className="text-muted"> · {r.buyer_persona}</span>
                      ) : null}
                    </td>
                    <td className="py-3 px-4 text-muted-strong">
                      {r.neighborhood || r.region ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={12} className="text-muted" />
                          {[r.neighborhood, r.region].filter(Boolean).join(', ')}
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-strong">
                      {r.instagram_handle ? (
                        <span className="inline-flex items-center gap-1">
                          <AtSign size={12} className="text-muted" />
                          {r.instagram_handle}
                          {r.social_followers ? (
                            <span className="text-muted">
                              {' · '}
                              {formatFollowers(r.social_followers)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 max-w-[220px]">
                      {r.contacts.length === 0 ? (
                        <span className="text-muted text-[12px]">-</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {r.contacts.map((c) => (
                            <div
                              key={c.id}
                              className="flex items-center gap-1.5 text-[12px] min-w-0"
                              title={[c.name, c.role, c.email].filter(Boolean).join(' · ')}
                            >
                              {c.email ? (
                                <span className="text-accent">✓</span>
                              ) : (
                                <UnlockButton contactId={c.id} />
                              )}
                              <span
                                className={`truncate ${
                                  c.email ? 'text-[var(--foreground)]' : 'text-muted-strong'
                                }`}
                              >
                                {c.name}
                                {c.role ? <span className="text-muted"> · {c.role}</span> : null}
                                {c.email ? <span className="text-muted"> · {c.email}</span> : null}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <form action={changeStage} className="inline-flex items-center gap-1.5">
                          <input type="hidden" name="id" value={r.id} />
                          <select
                            name="stage"
                            defaultValue={r.stage}
                            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--border-strong)]"
                          >
                            {ALL_STAGES.map((s) => (
                              <option key={s} value={s}>
                                {STAGE_LABELS[s] ?? s.replace('_', ' ')}
                              </option>
                            ))}
                            {r.stage === 'meeting_booked' ? (
                              <option value={HANDOFF_STAGE}>{STAGE_LABELS[HANDOFF_STAGE]}</option>
                            ) : null}
                          </select>
                          <button
                            type="submit"
                            className="bg-accent text-[var(--accent-foreground)] px-2.5 py-1 rounded text-[11px] font-medium hover:opacity-90 transition-opacity"
                          >
                            OK
                          </button>
                        </form>
                        {r.stage !== 'discarded' ? (
                          <form action={discardCompany} className="inline">
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              className="px-2.5 py-1 rounded text-[11px] font-medium border border-[var(--border)] text-muted hover:border-[oklch(0.55_0.18_25)] hover:text-[oklch(0.75_0.18_25)] transition-colors"
                            >
                              descartar
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

type SortKey = 'alta' | 'score';
type SortDir = 'asc' | 'desc';

/** companies.created_at → "dd/mm hh:mm" en hora de Buenos Aires. */
function formatAlta(iso: string): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => (parts.find((p) => p.type === t)?.value ?? '').padStart(2, '0');
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function scoreClass(s: number | null): string {
  if (s === null) return 'text-muted';
  if (s >= 80) return 'score-high';
  if (s >= 60) return 'score-mid';
  return 'score-low';
}

function formatFollowers(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
