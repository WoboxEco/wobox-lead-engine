/**
 * Formateo de resúmenes de "Generar mensajes" (reveal + drafts).
 * Funciones puras y sin dependencias de servidor: las usa el cliente del dashboard
 * (`@wobox/skills/summary`) para armar el resumen mientras procesa por lotes.
 */

/** Tope de reveals (créditos Apollo) por corrida de auto-reveal. */
export const MAX_REVEALS_PER_RUN = 10;

/** Motivos por los que una company queda sin email después del auto-reveal. */
export type RevealFailureReason =
  | 'sin_contactos'
  | 'sin_apollo_id'
  | 'apollo_sin_match'
  | 'apollo_sin_email'
  | 'apollo_sin_email_previo'
  | 'contacto_no_encontrado'
  | 'tope_reveals'
  | 'error';

export const REVEAL_REASON_LABELS: Record<RevealFailureReason, string> = {
  sin_contactos: 'sin contactos',
  sin_apollo_id: 'sin apollo id (Apollo sin match por nombre)',
  apollo_sin_match: 'Apollo sin match',
  apollo_sin_email: 'Apollo sin email',
  apollo_sin_email_previo: 'Apollo sin email (intento previo)',
  contacto_no_encontrado: 'contacto no encontrado',
  tope_reveals: `tope de ${MAX_REVEALS_PER_RUN} reveals`,
  error: 'error',
};

/** Fallo de generación de un draft (ver generate-messages). */
export interface GenerateFailure {
  companyId: string;
  company: string;
  /** Mensaje del error (agrupable). */
  reason: string;
}

function countBy(items: ReadonlyArray<{ reason: string }>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const f of items) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  return [...counts.entries()];
}

/** "2 Apollo sin match, 1 sin contactos" a partir de los fallos del reveal. */
export function formatRevealReasons(failures: ReadonlyArray<{ reason: string }>): string {
  return countBy(failures)
    .map(([reason, n]) => `${n} ${REVEAL_REASON_LABELS[reason as RevealFailureReason] ?? reason}`)
    .join(', ');
}

/**
 * Fallos de generación agrupados por motivo:
 * "6 fallaron: Prompt not found: messages/x" o "3 fallaron: 2 <motivo A>; 1 <motivo B>".
 */
export function formatFailures(failures: ReadonlyArray<{ reason: string }>): string {
  if (failures.length === 0) return '';
  const groups = countBy(failures).sort((a, b) => b[1] - a[1]);
  const detail =
    groups.length === 1 ? groups[0]![0] : groups.map(([r, n]) => `${n} ${r}`).join('; ');
  return `${failures.length} fallaron: ${detail}`;
}

export interface GenerateSummaryInput {
  channel: string;
  ok: number;
  noEmail: number;
  noContacts: number;
  failures: ReadonlyArray<{ reason: string }>;
  /** Solo email: resultado del auto-reveal. */
  revealed?: number;
  credits?: number;
  revealFailures?: ReadonlyArray<{ reason: string }>;
  revealError?: string;
}

/** Texto del resumen que se muestra en /pipeline tras "Generar mensajes". */
export function formatGenerateSummary(r: GenerateSummaryInput): string {
  const failed = formatFailures(r.failures);
  if (r.channel !== 'email') {
    return [`${r.ok} drafts (ver /drafts)`, failed].filter(Boolean).join(', ');
  }
  // Las companies sin contactos van aparte (no son "sin email").
  const reasons = formatRevealReasons(
    (r.revealFailures ?? []).filter((f) => f.reason !== 'sin_contactos'),
  );
  const parts = [
    `${r.ok} drafts`,
    `${r.revealed ?? 0} emails revelados (${r.credits ?? 0} créditos)`,
    `${r.noEmail} sin email${r.noEmail > 0 && reasons ? ` (motivos: ${reasons})` : ''}`,
  ];
  if (r.noContacts > 0) parts.push(`${r.noContacts} sin contactos`);
  if (failed) parts.push(failed);
  if (r.revealError) parts.push(`reveal falló: ${r.revealError.slice(0, 120)}`);
  return `${parts.join(', ')} (máx ${MAX_REVEALS_PER_RUN} reveals por corrida)`;
}
