import { signInWithGoogle } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen grid place-items-center px-6 bg-[radial-gradient(ellipse_at_top,oklch(0.22_0.05_152)_0%,oklch(0.14_0.005_240)_60%)]">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="size-10 rounded-xl bg-accent grid place-items-center font-bold text-[18px]">
            W
          </div>
          <div className="leading-tight">
            <p className="text-[14px] font-semibold tracking-tight">Wobox</p>
            <p className="text-[11.5px] text-muted">Lead Engine</p>
          </div>
        </div>

        <div className="surface p-7 backdrop-blur-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesion</h1>
          <p className="text-muted text-[13px] mt-1.5">
            Acceso restringido al equipo. Iniciá con tu cuenta de Wobox.
          </p>

          <form action={signInWithGoogle} className="mt-6">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2.5 bg-[var(--surface-elevated)] hover:bg-[var(--background)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-md py-2.5 text-[13.5px] font-medium transition-colors"
            >
              <GoogleIcon />
              Continuar con Google
            </button>
          </form>

          {error ? (
            <p className="mt-5 text-[12px] text-[oklch(0.75_0.18_25)] bg-[oklch(0.30_0.10_25/0.15)] border border-[oklch(0.40_0.12_25/0.4)] rounded-md px-3 py-2">
              {error}
            </p>
          ) : null}
        </div>

        <p className="text-center text-[11.5px] text-muted mt-6">
          Si necesitas acceso, hablá con el admin del equipo.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.96h5.5c-.24 1.5-1.74 4.4-5.5 4.4-3.32 0-6.04-2.74-6.04-6.12 0-3.38 2.72-6.12 6.04-6.12 1.9 0 3.16.8 3.88 1.5l2.64-2.55C16.84 3.78 14.66 2.8 12 2.8 6.96 2.8 2.86 6.9 2.86 12s4.1 9.2 9.14 9.2c5.28 0 8.78-3.7 8.78-8.92 0-.6-.06-1.06-.14-1.52H12z"
      />
    </svg>
  );
}
