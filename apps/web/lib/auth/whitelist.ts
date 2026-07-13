export type Role = 'admin' | 'sales';

// admin: acceso completo (Leads Engine + CRM, todas las companies).
// sales: solo /crm, y solo sus propias companies (owner o co-owner) — ver
// middleware.ts para el redirect y crm/page.tsx + crm/[id]/page.tsx para el filtro.
export const USERS: Record<string, Role> = {
  'sebastian@wobox.ar': 'admin',
  'juan@wobox.ar': 'admin',
  'vir@wobox.ar': 'admin',
  'renzo.moretti@wobox.ar': 'sales',
  'sebastian.bazan@wobox.ar': 'sales',
};

export const ALLOWED_EMAILS = new Set<string>(Object.keys(USERS));

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.has(email.toLowerCase().trim());
}

export function getRole(email: string | null | undefined): Role | null {
  if (!email) return null;
  return USERS[email.toLowerCase().trim()] ?? null;
}

export function isAdmin(email: string | null | undefined): boolean {
  return getRole(email) === 'admin';
}
