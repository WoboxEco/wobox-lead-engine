import { buildDailySummary, createAdminClient, parsePeriod } from '@wobox/core';
import { ArrowDownRight, ArrowUpRight, Clock, Sparkles, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

const VALID_PERIODS = new Set(['1d', '7d', '30d']);

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

export default async function DailyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; venture?: string }>;
}) {
  const { period: rawPeriod, venture: rawVenture } = await searchParams;
  const period = rawPeriod && VALID_PERIODS.has(rawPeriod) ? rawPeriod : '1d';
  const venture = rawVenture ?? null;

  const db = createAdminClient();
  const hours = parsePeriod(period);
  const summary = await buildDailySummary(db, hours, venture);

  const ventureRows = Object.entries(summary.by_venture).sort(([a], [b]) => a.localeCompare(b));
  const generatedAt = new Date(summary.generated_at).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const periodLabel = ((p: string) => {
    if (p === '7d') return 'Ultimos 7 dias';
    if (p === '30d') return 'Ultimos 30 dias';
    return 'Ultimas 24h';
  })(period);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1 flex items-center gap-1.5">
            <Sparkles size={12} className="text-accent" />
            Daily review
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{periodLabel}</h1>
          <p className="text-muted mt-1.5 text-[13.5px] flex items-center gap-1.5">
            <Clock size={13} />
            actualizado {generatedAt}
            {summary.venture_filter ? ` · ${VENTURE_LABELS[summary.venture_filter]}` : null}
          </p>
        </div>
        <PeriodSwitcher current={period} venture={venture} />
      </div>

      {/* Activity en la ventana */}
      <section>
        <SectionHeader
          title="Actividad"
          subtitle={`Que se movio en ${periodLabel.toLowerCase()}`}
          icon={TrendingUp}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat label="Nuevas companies" value={summary.new_companies} variant="info" />
          <Stat label="Mensajes enviados" value={summary.messages_sent} />
          <Stat label="Replies" value={summary.replies} />
          <Stat label="Meetings" value={summary.meetings_booked} variant="success" />
        </div>
      </section>

      {/* Accion pendiente */}
      <section>
        <SectionHeader
          title="Accion pendiente"
          subtitle="Lo que requiere tu atencion ahora"
          icon={ArrowUpRight}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <Stat
            label="Drafts por aprobar"
            value={summary.drafts_pending}
            variant={summary.drafts_pending > 0 ? 'warn' : 'default'}
          />
          <Stat label="Nurture hoy" value={summary.nurture_today} />
          <Stat label="Qualified vigentes" value={summary.qualified_without_contact} />
        </div>
      </section>

      {/* Breakdown por venture */}
      <section>
        <SectionHeader
          title="Breakdown por venture"
          subtitle="Detalle por producto"
          icon={ArrowDownRight}
        />
        {ventureRows.length === 0 ? (
          <div className="surface p-8 text-center mt-4">
            <p className="text-muted">Sin datos en la ventana.</p>
          </div>
        ) : (
          <div className="surface mt-4 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted border-b border-[var(--border)]">
                  <th className="py-3 px-4">Venture</th>
                  <th className="py-3 px-4 text-right">Nuevas</th>
                  <th className="py-3 px-4 text-right">Qualified</th>
                  <th className="py-3 px-4 text-right">Nurturing</th>
                  <th className="py-3 px-4 text-right">Meetings</th>
                  <th className="py-3 px-4 text-right">Drafts</th>
                </tr>
              </thead>
              <tbody>
                {ventureRows.map(([v, b]) => (
                  <tr
                    key={v}
                    className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-elevated)] transition-colors"
                  >
                    <td className="py-3 px-4 font-medium">{VENTURE_LABELS[v] ?? v}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{b.new_companies}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{b.qualified}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{b.nurturing}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{b.meeting_booked}</td>
                    <td className="py-3 px-4 text-right tabular-nums">{b.drafts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type StatVariant = 'default' | 'success' | 'warn' | 'info';

function Stat({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: number;
  variant?: StatVariant;
}) {
  const accentClasses: Record<StatVariant, string> = {
    default: '',
    success: 'text-accent',
    warn: 'text-[oklch(0.78_0.16_75)]',
    info: 'text-[oklch(0.75_0.13_235)]',
  };
  return (
    <div className="surface p-4">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${accentClasses[variant]}`}>
        {value}
      </p>
    </div>
  );
}

function PeriodSwitcher({ current, venture }: { current: string; venture: string | null }) {
  const items: Array<{ key: string; label: string }> = [
    { key: '1d', label: '24h' },
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-[var(--border)] bg-[var(--surface)]">
      {items.map((it) => {
        const params = new URLSearchParams();
        params.set('period', it.key);
        if (venture) params.set('venture', venture);
        const isActive = it.key === current;
        return (
          <a
            key={it.key}
            href={`/daily-review?${params.toString()}`}
            className={
              isActive
                ? 'px-3 py-1.5 rounded-[6px] bg-accent text-[var(--accent-foreground)] text-[12px] font-medium tabular-nums transition-colors'
                : 'px-3 py-1.5 rounded-[6px] text-muted-strong hover:text-[var(--foreground)] text-[12px] font-medium tabular-nums transition-colors'
            }
          >
            {it.label}
          </a>
        );
      })}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex items-baseline gap-2">
      {Icon ? <Icon size={14} className="text-muted" /> : null}
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-[12.5px] text-muted mt-0.5">{subtitle}</p> : null}
      </div>
    </div>
  );
}
