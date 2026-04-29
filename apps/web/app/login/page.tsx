import { signInWithGoogle } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div style={{ maxWidth: 360, margin: '6rem auto', textAlign: 'center' }}>
      <h1>Wobox Lead Engine</h1>
      <p className="subtitle">Acceso restringido al equipo</p>

      <form action={signInWithGoogle} style={{ marginTop: '2rem' }}>
        <button
          type="submit"
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            cursor: 'pointer',
            border: '1px solid #ccc',
            borderRadius: 6,
            background: 'white',
          }}
        >
          Sign in with Google
        </button>
      </form>

      {error ? (
        <p style={{ marginTop: '1.5rem', color: '#c00' }} className="subtitle">
          {error}
        </p>
      ) : null}
    </div>
  );
}
