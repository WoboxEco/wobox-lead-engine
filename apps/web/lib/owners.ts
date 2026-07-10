import { createAdminClient } from '@wobox/core';
import { ALLOWED_EMAILS } from './auth/whitelist';

export interface Owner {
  id: string;
  email: string;
  displayName: string;
}

// Unico lugar que resuelve "quien puede ser owner" -> nombre legible. Los uuids de
// auth.users no tienen nombre propio guardado; se deriva del email (unico dato
// legible disponible) contra la misma whitelist que ya gatea el login.
export async function getOwnerDirectory(): Promise<Owner[]> {
  const db = createAdminClient();
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
  if (error || !data) return [];

  const owners: Owner[] = [];
  for (const u of data.users) {
    if (!u.email || !ALLOWED_EMAILS.has(u.email.toLowerCase())) continue;
    owners.push({ id: u.id, email: u.email, displayName: displayNameFromEmail(u.email) });
  }
  return owners.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
