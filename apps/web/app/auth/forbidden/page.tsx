import { ShieldX } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen grid place-items-center px-6 bg-[radial-gradient(ellipse_at_top,oklch(0.22_0.05_152)_0%,oklch(0.14_0.005_240)_60%)]">
      <div className="w-full max-w-sm text-center">
        <div className="size-12 rounded-xl bg-[oklch(0.30_0.10_25/0.25)] border border-[oklch(0.40_0.12_25/0.4)] grid place-items-center mx-auto mb-5">
          <ShieldX size={22} className="text-[oklch(0.75_0.18_25)]" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Acceso denegado</h1>
        <p className="text-muted text-[13.5px] mt-2">
          Tu email no está autorizado para usar Wobox Lead Engine.
        </p>
        <p className="text-muted text-[12.5px] mt-3">
          Si creés que es un error, hablá con el admin del equipo.
        </p>

        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 bg-[var(--surface-elevated)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-md px-4 py-2 text-[13px] font-medium transition-colors"
          >
            Cerrar sesion y volver
          </button>
        </form>
      </div>
    </div>
  );
}
