import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Wobox Lead Engine',
  description: 'Motor unificado de leads outbound para Wobox y Loop',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const headerList = await headers();
  const userEmail = headerList.get('x-user-email');

  return (
    <html lang="es">
      <body>
        <main>
          <nav className="top">
            <a href="/">Home</a>
            <a href="/pipeline">Pipeline</a>
            <a href="/drafts">Drafts</a>
            <a href="/nurture">Nurture hoy</a>
            <a href="/campaigns">Campaigns</a>
            {userEmail ? (
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'center',
                }}
              >
                <span className="subtitle" style={{ fontSize: '0.85rem' }}>
                  {userEmail}
                </span>
                <form action="/auth/signout" method="post" style={{ display: 'inline' }}>
                  <button
                    type="submit"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      fontSize: '0.85rem',
                    }}
                  >
                    Salir
                  </button>
                </form>
              </span>
            ) : null}
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
