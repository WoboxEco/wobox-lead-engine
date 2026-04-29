export const dynamic = 'force-dynamic';

export default function ForbiddenPage() {
  return (
    <div style={{ maxWidth: 480, margin: '6rem auto', textAlign: 'center' }}>
      <h1>Acceso denegado</h1>
      <p className="subtitle">Tu email no está autorizado para usar Wobox Lead Engine.</p>
      <p className="subtitle" style={{ marginTop: '1rem' }}>
        Si creés que es un error, hablá con el admin del equipo.
      </p>

      <form action="/auth/signout" method="post" style={{ marginTop: '2rem' }}>
        <button
          type="submit"
          style={{
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            border: '1px solid #ccc',
            borderRadius: 6,
            background: 'white',
          }}
        >
          Cerrar sesión y volver
        </button>
      </form>
    </div>
  );
}
