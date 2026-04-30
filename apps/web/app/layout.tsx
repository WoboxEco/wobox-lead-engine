import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { MobileTopbar, Sidebar } from '../components/sidebar';
import { getTheme } from './theme/actions';
import './globals.css';

export const metadata = {
  title: 'Wobox Lead Engine',
  description: 'Motor unificado de leads outbound para Wobox y Loop',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [headerList, theme] = await Promise.all([headers(), getTheme()]);
  const userEmail = headerList.get('x-user-email');

  // /login y /auth/forbidden no muestran shell (no hay sesion o esta cortada)
  if (!userEmail) {
    return (
      <html lang="es" data-theme={theme}>
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="es" data-theme={theme}>
      <body>
        <div className="min-h-screen flex flex-col md:flex-row">
          <Sidebar userEmail={userEmail} theme={theme} />
          <div className="flex-1 flex flex-col min-w-0">
            <MobileTopbar userEmail={userEmail} theme={theme} />
            <main className="flex-1 px-5 md:px-8 py-6 md:py-8 max-w-[1280px] w-full mx-auto">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
