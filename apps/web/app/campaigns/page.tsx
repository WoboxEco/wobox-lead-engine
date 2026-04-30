import { createAdminClient } from '@wobox/core';
import { CheckCircle2, Megaphone, Pause, Play, XCircle } from 'lucide-react';
import { createCampaign, setCampaignStatus } from './actions';

export const dynamic = 'force-dynamic';

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

export default async function CampaignsPage() {
  const db = createAdminClient();

  const { data: campaigns, error } = await db
    .from('campaigns')
    .select('id, name, venture, status, vertical_focus, region_focus, started_at, ended_at')
    .order('started_at', { ascending: false });

  if (error) {
    return (
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-muted mt-2">Error: {error.message}</p>
      </div>
    );
  }

  type Campaign = {
    id: string;
    name: string;
    venture: string;
    status: string;
    vertical_focus: string | null;
    region_focus: string | null;
    started_at: string;
    ended_at: string | null;
  };

  const rows = (campaigns as unknown as Campaign[]) ?? [];

  const { data: companies } = await db
    .from('companies')
    .select('campaign_id, stage')
    .not('campaign_id', 'is', null);

  const companyRows = (companies as unknown as Array<{ campaign_id: string; stage: string }>) ?? [];
  const countsByCampaign = new Map<string, { total: number; qualified: number; booked: number }>();
  for (const c of companyRows) {
    const entry = countsByCampaign.get(c.campaign_id) ?? { total: 0, qualified: 0, booked: 0 };
    entry.total++;
    if (c.stage === 'qualified') entry.qualified++;
    if (c.stage === 'meeting_booked') entry.booked++;
    countsByCampaign.set(c.campaign_id, entry);
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1 flex items-center gap-1.5">
          <Megaphone size={12} className="text-accent" />
          Campaigns
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{rows.length} campaigns</h1>
        <p className="text-muted mt-1.5 text-[13.5px]">Iniciativas activas + historial</p>
      </div>

      {/* Crear campaign */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-tight mb-3">Crear campaign</h2>
        <form action={createCampaign} className="surface p-5 grid gap-3 md:grid-cols-2">
          <input
            name="name"
            required
            placeholder="Nombre (ej: Q2 Gastro Palermo)"
            className={inputCls}
          />
          <select name="venture" required defaultValue="loop" className={inputCls}>
            <option value="loop">Loop</option>
            <option value="wobox_food">Wobox Food</option>
            <option value="wobox_fashion">Wobox Fashion</option>
          </select>
          <input
            name="vertical_focus"
            placeholder="Vertical focus (ej: cafeteria)"
            className={inputCls}
          />
          <input
            name="region_focus"
            placeholder="Region focus (ej: Palermo Soho)"
            className={inputCls}
          />
          <textarea
            name="approach_strategy"
            placeholder="Estrategia (opcional)"
            rows={2}
            className={`${inputCls} md:col-span-2 font-sans resize-y`}
          />
          <div className="md:col-span-2">
            <button type="submit" className={btnPrimary}>
              Crear campaign
            </button>
          </div>
        </form>
      </section>

      {/* Lista */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-tight mb-3">Historial</h2>
        {rows.length === 0 ? (
          <div className="surface p-12 text-center">
            <p className="text-muted">Sin campaigns todavia.</p>
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted border-b border-[var(--border)]">
                    <th className="py-3 px-4">Nombre</th>
                    <th className="py-3 px-4">Venture</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Focus</th>
                    <th className="py-3 px-4">Companies</th>
                    <th className="py-3 px-4">Periodo</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const counts = countsByCampaign.get(c.id) ?? {
                      total: 0,
                      qualified: 0,
                      booked: 0,
                    };
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-elevated)] transition-colors"
                      >
                        <td className="py-3 px-4 font-medium">{c.name}</td>
                        <td className="py-3 px-4 text-muted-strong">
                          {VENTURE_LABELS[c.venture] ?? c.venture}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`pill ${
                              c.status === 'active'
                                ? 'stage-qualified'
                                : c.status === 'paused'
                                  ? 'stage-nurturing'
                                  : 'stage-discarded'
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[12.5px] text-muted-strong">
                          {c.vertical_focus ?? '-'}
                          {c.region_focus ? (
                            <span className="text-muted"> · {c.region_focus}</span>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 tabular-nums">
                          {counts.total}
                          <span className="text-muted text-[11.5px] ml-1.5">
                            ({counts.qualified} qual · {counts.booked} booked)
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[11.5px] text-muted mono">
                          {c.started_at.slice(0, 10)}
                          {c.ended_at ? <span> → {c.ended_at.slice(0, 10)}</span> : null}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5">
                            {c.status !== 'active' ? (
                              <form action={setCampaignStatus}>
                                <input type="hidden" name="id" value={c.id} />
                                <input type="hidden" name="status" value="active" />
                                <button type="submit" className={btnSmall}>
                                  <Play size={11} /> Activar
                                </button>
                              </form>
                            ) : (
                              <form action={setCampaignStatus}>
                                <input type="hidden" name="id" value={c.id} />
                                <input type="hidden" name="status" value="paused" />
                                <button type="submit" className={btnSmall}>
                                  <Pause size={11} /> Pausar
                                </button>
                              </form>
                            )}
                            {c.status !== 'completed' ? (
                              <form action={setCampaignStatus}>
                                <input type="hidden" name="id" value={c.id} />
                                <input type="hidden" name="status" value="completed" />
                                <button type="submit" className={btnSmall}>
                                  <CheckCircle2 size={11} /> Cerrar
                                </button>
                              </form>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted text-[11px]">
                                <XCircle size={11} /> cerrada
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const inputCls =
  'bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--border-strong)]';

const btnPrimary =
  'inline-flex items-center gap-1.5 bg-accent text-[var(--accent-foreground)] px-4 py-2 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity';

const btnSmall =
  'inline-flex items-center gap-1 bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--foreground)] px-2.5 py-1 rounded text-[11.5px] font-medium hover:border-[var(--border-strong)] transition-colors';
