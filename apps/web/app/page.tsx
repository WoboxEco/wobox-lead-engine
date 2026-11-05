import { type PipelineCounts, countRows, createAdminClient, getPipelineCounts } from '@wobox/core';
import { ArrowRight, Files, KanbanSquare, Sparkles } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STAGES_ORDER = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
] as const;

const DEAL_STAGES_ORDER = [
  'deal_sin_contacto',
  'deal_contacto',
  'deal_presentacion',
  'deal_negociacion',
  'deal_onboarding',
  'deal_ganado',
  'deal_perdido',
] as const;

const STAGE_LABELS: Record<string, string> = {
  new: 'Nuevas',
  enriched: 'Enriquecidas',
  qualified: 'Qualified',
  nurturing: 'En nurture',
  contacted: 'Contactadas',
  meeting_booked: 'Meetings',
  discarded: 'Descartadas',
  deal_sin_contacto: 'Sin contacto',
  deal_contacto: 'Contacto',
  deal_presentacion: 'Presentacion',
  deal_negociacion: 'Negociacion',
  deal_onboarding: 'Onboarding',
  deal_ganado: 'Ganados',
  deal_perdido: 'Perdidos',
};

const VENTURE_LABELS: Record<string, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

export default async function HomePage() {
  const db = createAdminClient();
  // Conteos via head-count queries (no select de filas): Supabase corta los selects
  // en 1000 filas, asi que contar en memoria daba numeros truncados.
  let counts: PipelineCounts;
  let draftsCount: number;
  try {
    [counts, draftsCount] = await Promise.all([
      getPipelineCounts(db),
      countRows(
        db.from('messages').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      ),
    ]);
  } catch (err) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-muted mt-2">Error cargando datos: {(err as Error).message}</p>
      </div>
    );
  }

  const byStage = counts.byStage;
  const activeTotal = counts.active;
  const meetingsTotal = byStage.meeting_booked ?? 0;
  const qualifiedTotal = byStage.qualified ?? 0;
  const nurturingTotal = byStage.nurturing ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1">Wobox Lead Engine</p>
        <h1 className="text-3xl font-semibold tracking-tight">Pipeline general</h1>
        <p className="text-muted mt-1.5 text-[13.5px]">
          {activeTotal} companies activas · {counts.total} totales
        </p>
      </div>

      {/* Headline KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Activas" value={activeTotal} hint="excluye descartadas" />
        <KpiCard label="Qualified" value={qualifiedTotal} hint="listas para contacto" highlight />
        <KpiCard label="En nurture" value={nurturingTotal} hint="secuencia 2 / 5 / 10 d" />
        <KpiCard label="Meetings" value={meetingsTotal} hint="agendadas" />
      </section>

      {/* Por stage */}
      <section>
        <SectionHeader title="Por stage" subtitle="Distribucion del pipeline" />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 mt-4">
          {STAGES_ORDER.map((s) => (
            <StageCard key={s} stage={s} value={byStage[s] ?? 0} />
          ))}
        </div>
      </section>

      {/* Deals (post-meeting, reemplaza al pipeline de HubSpot) */}
      <section>
        <SectionHeader title="Deals" subtitle="Pipeline de ventas post-meeting" />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 mt-4">
          {DEAL_STAGES_ORDER.map((s) => (
            <StageCard key={s} stage={s} value={byStage[s] ?? 0} />
          ))}
        </div>
      </section>

      {/* Por venture */}
      <section>
        <SectionHeader title="Por venture" subtitle="Companies activas en cada producto" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {Object.entries(counts.byVenture)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([v, n]) => (
              <VentureCard key={v} venture={v} value={n} />
            ))}
        </div>
      </section>

      {/* Quick links */}
      <section>
        <SectionHeader title="Atajos" subtitle="Acceso rapido a operacion" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <QuickLink
            href="/drafts"
            icon={Files}
            title="Drafts"
            count={draftsCount}
            description="Mensajes esperando aprobacion"
          />
          <QuickLink
            href="/pipeline"
            icon={KanbanSquare}
            title="Pipeline"
            count={activeTotal}
            description="Tabla filtrable de companies"
          />
          <QuickLink
            href="/daily-review"
            icon={Sparkles}
            title="Daily review"
            description="KPIs cross-venture 24h / 7d / 30d"
          />
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`surface p-4 ${highlight ? 'ring-1 ring-[var(--accent)] bg-accent-soft' : ''}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${highlight ? 'text-accent' : ''}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

function StageCard({ stage, value }: { stage: string; value: number }) {
  return (
    <div className="surface p-3.5">
      <span className={`pill stage-${stage}`}>{STAGE_LABELS[stage] ?? stage}</span>
      <p className="mt-2.5 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function VentureCard({ venture, value }: { venture: string; value: number }) {
  return (
    <div className="surface p-5 hover:border-[var(--border-strong)] transition-colors">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">
        {VENTURE_LABELS[venture] ?? venture}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[12px] text-muted">companies en pipeline</p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  count,
  description,
}: {
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  count?: number;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="surface p-4 group hover:border-[var(--border-strong)] transition-colors flex items-start gap-3"
    >
      <div className="size-9 rounded-md bg-accent-soft text-accent grid place-items-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-[14px]">{title}</p>
          {typeof count === 'number' ? (
            <span className="text-[12px] text-muted tabular-nums">{count}</span>
          ) : null}
        </div>
        <p className="text-[12px] text-muted mt-0.5">{description}</p>
      </div>
      <ArrowRight
        size={16}
        className="text-muted group-hover:text-[var(--foreground)] transition-colors mt-1 shrink-0"
      />
    </Link>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-[12.5px] text-muted mt-0.5">{subtitle}</p> : null}
      </div>
    </div>
  );
}
