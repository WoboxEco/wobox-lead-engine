import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Wobox Lead Engine',
  description: 'Motor unificado de leads outbound para Wobox y Loop',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <main>
          <nav className="top">
            <a href="/">Home</a>
            <a href="/pipeline">Pipeline</a>
            <a href="/drafts">Drafts</a>
            <a href="/nurture">Nurture hoy</a>
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
