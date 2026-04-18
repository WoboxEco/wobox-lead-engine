import type { ReactNode } from 'react';

export const metadata = {
  title: 'Wobox Lead Engine',
  description: 'Motor unificado de leads outbound para Wobox y Loop',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
