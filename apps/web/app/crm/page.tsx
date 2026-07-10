import { createAdminClient } from '@wobox/core';
import { Filter, X } from 'lucide-react';
import Link from 'next/link';
import { getOwnerDirectory } from '../../lib/owners';
import { changeStage } from '../pipeline/actions';

export const dynamic = 'force-dynamic';

// CRM: pipeline de ventas post-meeting (reemplaza a HubSpot). Separado del Leads
// Engine por stage (deal_* vs STAGES) y por venture (Food/Fashion/Loop son 3
// negocios distintos, no un solo pipeline compartido).
const DEAL_STAGES = [
  'deal_sin_contacto',
  'deal_contacto',
  'deal_presentacion',
  'deal_negociacion',
  'deal_onboarding',
  'deal_ganado',
  'deal_perdido',
];

const STAGE_LABELS: Record<string, string> = {
  deal_sin_contacto: 'Sin contacto',
  deal_contacto: 'Contacto',
  deal_presentacion: 'Presentacion',
  deal_negociacion: 'Negociacion',
  deal_onboarding: 'Onboarding',
  deal_ganado: 'Ganado',
  deal_perdido: 'Perdido',
};

const VENTURE_TABS: Array<{ value: string; label: string }> = [
  { value: 'wobox_food', label: 'Food' },
  { value: 'wobox_fashion', label: 'Fashion' },
  { value: 'loop', label: 'Loop' },
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CrmPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture) ?? 'wobox_food';
  const stage = pickString(params.stage);

  const db = createAdminClient();

  let q = db
    .from('companies')
    .select(
      'id, name, venture, stage, deal_value, lost_reason, region, hubspot_deal_id, assigned_to, contacts(id, name, role, email, phone)',
    )
    .eq('venture', venture)
    .order('stage_entered_at', { ascending: false })
    .limit(200);
  q = stage ? q.eq('stage', stage) : q.in('stage', DEAL_STAGES);

  const [{ data, error }, { data: funnelData }, owners] = await Promise.all([
    q,
    db.from('companies').select('stage').eq('venture', venture).in('stage', DEAL_STAGES),
    getOwnerDirectory(),
  ]);
  const ownerById = new Map(owners.map((o) => [o.id, o.displayName]));

  if (error) {
    return <p className="text-muted">Error: {error.message}</p>;
  }

  const funnelCounts = new Map<string, number>();
  for (const r of (funnelData as Array<{ stage: string }> | null) ?? []) {
    funnelCounts.set(r.stage, (funnelCounts.get(r.stage) ?? 0) + 1);
  }

  type Row = {
    id: string;
    name: string;
    venture: string;
    stage: string;
    deal_value: number | null;
    lost_reason: string | null;
    region: string | null;
    hubspot_deal_id: string | null;
    assigned_to: string | null;
    contacts: Array<{
      id: string;
      name: string;
      role: string | null;
      email: string | null;
      phone: string | null;
    }>;
  };

  const rows = (data as unknown as Row[]) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1">CRM</p>
          <h1 className="text-3xl font-semibold tracking-tight">Deals</h1>
          <p className="text-muted mt-1.5 text-[13.5px]">
            {rows.length} resultados
            {stage && ` · ${STAGE_LABELS[stage] ?? stage}`}
          </p>
        </div>
        <Link
          href={`/crm/new?venture=${venture}`}
          className="bg-accent text-[var(--accent-foreground)] px-3.5 py-2 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity shrink-0"
        >
          + Nueva empresa
        </Link>
      </div>

      {/* Tabs por venture — 3 negocios distintos, no un pipeline compartido */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {VENTURE_TABS.map((t) => (
          <Link
            key={t.value}
            href={`/crm?venture=${t.value}`}
            className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
              venture === t.value
                ? 'border-[var(--accent)] text-[var(--foreground)]'
                : 'border-transparent text-muted hover:text-[var(--foreground)]'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Funnel del venture actual — cuenta total por stage, sin importar el filtro de abajo */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {DEAL_STAGES.map((s) => (
          <Link
            key={s}
            href={`/crm?venture=${venture}&stage=${s}`}
            className={`surface p-3.5 hover:border-[var(--border-strong)] transition-colors ${
              stage === s ? 'ring-1 ring-[var(--accent)]' : ''
            }`}
          >
            <span className={`pill stage-${s}`}>{STAGE_LABELS[s]}</span>
            <p className="mt-2.5 text-2xl font-semibold tracking-tight">
              {funnelCounts.get(s) ?? 0}
            </p>
          </Link>
        ))}
      </div>

      {/* Filtro por stage dentro del venture actual */}
      <form method="get" className="surface p-4">
        <input type="hidden" name="venture" value={venture} />
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-muted shrink-0" />
          <select
            name="stage"
            defaultValue={stage ?? ''}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]"
          >
            <option value="">Todos los stages</option>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            Filtrar
          </button>
          {stage ? (
            <Link
              href={`/crm?venture=${venture}`}
              className="text-muted hover:text-[var(--foreground)] text-[12.5px] flex items-center gap-1 transition-colors"
            >
              <X size={13} /> reset
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-muted">
            Sin deals todavia en {VENTURE_TABS.find((t) => t.value === venture)?.label}.
          </p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted border-b border-[var(--border)]">
                  <th className="py-3 px-4">Company</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4">Owner</th>
                  <th className="py-3 px-4">Valor</th>
                  <th className="py-3 px-4">Ubicacion</th>
                  <th className="py-3 px-4">Contactos</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-elevated)] transition-colors"
                  >
                    <td className="py-3 px-4 font-medium">
                      <Link href={`/crm/${r.id}`} className="hover:text-accent transition-colors">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`pill stage-${r.stage}`}>
                        {STAGE_LABELS[r.stage] ?? r.stage}
                      </span>
                      {r.stage === 'deal_perdido' && r.lost_reason ? (
                        <span className="block text-[11px] text-muted mt-1">{r.lost_reason}</span>
                      ) : null}
                    </td>
                    <td className="py-3 px-4 text-muted-strong">
                      {r.assigned_to ? (
                        (ownerById.get(r.assigned_to) ?? 'Sin asignar')
                      ) : (
                        <span className="text-muted">Sin asignar</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-strong tabular-nums">
                      {r.deal_value ? `$${r.deal_value.toLocaleString('es-AR')}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-muted-strong">{r.region || '-'}</td>
                    <td className="py-3 px-4">
                      {r.contacts.length === 0 ? (
                        <span className="text-muted text-[12px]">-</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {r.contacts.map((c) => (
                            <div key={c.id} className="text-[12px]">
                              <span className="text-[var(--foreground)]">{c.name}</span>
                              {c.role && <span className="text-muted"> · {c.role}</span>}
                              {c.email && <span className="text-muted"> · {c.email}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <form
                        action={changeStage}
                        className="inline-flex items-center justify-end gap-1.5 w-full"
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <select
                          name="stage"
                          defaultValue={r.stage}
                          className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--border-strong)]"
                        >
                          {DEAL_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="bg-accent text-[var(--accent-foreground)] px-2.5 py-1 rounded text-[11px] font-medium hover:opacity-90 transition-opacity"
                        >
                          OK
                        </button>
                      </form>
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

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
