import {
  CalendarClock,
  CircleUser,
  Files,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  description?: string;
}

const NAV_TOP: NavItem[] = [
  { href: '/', label: 'Pipeline', icon: LayoutDashboard, description: 'Resumen global' },
  { href: '/pipeline', label: 'Companies', icon: KanbanSquare, description: 'Tabla detallada' },
  { href: '/drafts', label: 'Drafts', icon: Files, description: 'Mensajes por aprobar' },
];

const NAV_OPS: NavItem[] = [
  {
    href: '/nurture',
    label: 'Nurture hoy',
    icon: CalendarClock,
    description: 'Touchpoints del dia',
  },
  {
    href: '/daily-review',
    label: 'Daily review',
    icon: Sparkles,
    description: 'KPIs cross-venture',
  },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone, description: 'Iniciativas activas' },
];

export function Sidebar({ userEmail }: { userEmail: string | null }) {
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] sticky top-0 h-screen">
      <div className="px-5 py-6 border-b border-[var(--border)]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="size-8 rounded-lg bg-accent grid place-items-center font-bold text-[15px]">
            W
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold tracking-tight">Wobox</p>
            <p className="text-[11px] text-muted">Lead Engine</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <NavSection title="Pipeline" items={NAV_TOP} />
        <NavSection title="Operacion" items={NAV_OPS} />
      </nav>

      {userEmail ? (
        <div className="border-t border-[var(--border)] px-3 py-3">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-[var(--surface-elevated)]">
            <CircleUser size={18} className="text-muted shrink-0" />
            <p className="text-[12px] text-muted-strong truncate flex-1" title={userEmail}>
              {userEmail}
            </p>
            <form action="/auth/signout" method="post" className="shrink-0">
              <button
                type="submit"
                className="text-muted hover:text-[var(--foreground)] transition-colors"
                aria-label="Cerrar sesion"
                title="Cerrar sesion"
              >
                <LogOut size={15} />
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div>
      <p className="px-3 mb-2 text-[10.5px] font-medium text-muted uppercase tracking-[0.08em]">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-[13.5px] text-muted-strong hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)] transition-colors"
            >
              <item.icon size={16} className="shrink-0" />
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MobileTopbar({ userEmail }: { userEmail: string | null }) {
  return (
    <header className="md:hidden sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-4 h-12 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2">
        <div className="size-6 rounded-md bg-accent grid place-items-center font-bold text-[12px]">
          W
        </div>
        <span className="text-[13px] font-semibold tracking-tight">Wobox</span>
      </Link>
      {userEmail ? (
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-muted" aria-label="Salir">
            <LogOut size={16} />
          </button>
        </form>
      ) : null}
    </header>
  );
}
