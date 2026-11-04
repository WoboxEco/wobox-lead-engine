/**
 * Selección del contacto destinatario de una company.
 * Funciones puras (sin DB) para poder testearlas y reutilizarlas entre
 * generate-messages y el auto-reveal de emails.
 */

export interface SelectableContact {
  id: string;
  email?: string | null;
  is_decision_maker?: boolean | null;
}

export function hasEmail(contact: SelectableContact | null | undefined): boolean {
  return typeof contact?.email === 'string' && contact.email.trim().length > 0;
}

/**
 * Contacto para channel=email. Prioridad:
 *   1. decision-maker con email
 *   2. cualquier contacto con email
 *   3. decision-maker sin email (candidato a revelar)
 *   4. primer contacto (candidato a revelar)
 * `hasEmail` indica si el elegido ya tiene email (si es false, hay que revelar).
 */
export function selectEmailContact<T extends SelectableContact>(
  contacts: readonly T[] | null | undefined,
): { contact: T | null; hasEmail: boolean } {
  const list = contacts ?? [];
  const withEmail = list.filter((c) => hasEmail(c));
  const chosen =
    withEmail.find((c) => c.is_decision_maker) ??
    withEmail[0] ??
    list.find((c) => c.is_decision_maker) ??
    list[0] ??
    null;
  return { contact: chosen, hasEmail: hasEmail(chosen) };
}

/**
 * Contacto destinatario según canal. Con `preferId` se respeta ese contacto.
 * Email: ver `selectEmailContact`. Otros canales: decision-maker > primero.
 */
export function selectContact<T extends SelectableContact>(
  contacts: readonly T[] | null | undefined,
  opts: { channel?: string; preferId?: string | undefined } = {},
): T | null {
  const list = contacts ?? [];
  if (list.length === 0) return null;
  if (opts.preferId) return list.find((c) => c.id === opts.preferId) ?? null;
  if (opts.channel === 'email') return selectEmailContact(list).contact;
  return list.find((c) => c.is_decision_maker) ?? list[0] ?? null;
}
