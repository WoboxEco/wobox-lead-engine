import type { DbClient, Venture } from '@wobox/core';
import { apollo } from '@wobox/integrations';
import { selectEmailContact } from './contact-selection.js';

/** Tope de reveals (créditos Apollo) por corrida de auto-reveal. */
export const MAX_REVEALS_PER_RUN = 10;

/** Marca en contacts.contact_source cuando Apollo encontró a la persona pero sin email.
 *  El auto-reveal saltea esos contactos para no gastar créditos de nuevo en cada corrida. */
export const NO_EMAIL_SOURCE = 'apollo (sin email)';

const SEARCH_TITLES = [
  'Manager',
  'Director',
  'CEO',
  'Founder',
  'Owner',
  'Head',
  'VP',
  'Chief',
  'Commercial',
  'Gerente',
  'Presidente',
  'Socio',
  'Partner',
];

export type RevealResult =
  | {
      status: 'revealed';
      email: string;
      name: string | null;
      linkedin_url: string | null;
      /** Créditos Apollo gastados (matchPerson) */
      credits: number;
    }
  | { status: 'contact_not_found'; credits: 0 }
  | { status: 'person_not_found'; credits: number }
  | { status: 'no_email'; credits: number };

type ContactWithCompany = {
  id: string;
  name: string;
  role: string | null;
  company_id: string;
  companies: { name: string; venture: string; apollo_id: string | null } | null;
};

/**
 * Revela el email de un contacto vía Apollo (searchDecisionMakers + matchPerson)
 * y lo guarda en contacts. matchPerson registra 1 crédito en api_usage (service=apollo).
 * Devuelve el detalle del resultado; ver `revealContactEmail` para la versión email | null.
 */
export async function revealContact(
  db: DbClient,
  contactId: string,
  operation = 'reveal-email',
): Promise<RevealResult> {
  const { data: contact, error: cErr } = await db
    .from('contacts')
    .select('id, name, role, company_id, companies(name, venture, apollo_id)')
    .eq('id', contactId)
    .single();
  if (cErr || !contact) return { status: 'contact_not_found', credits: 0 };

  const c = contact as unknown as ContactWithCompany;
  const venture = (c.companies?.venture ?? 'wobox_food') as Venture;
  const firstName = c.name.split(' ')[0] ?? c.name;
  const apolloOrgId = c.companies?.apollo_id;

  // Si tenemos el ID de la org en Apollo, buscamos el person ID exacto primero (gratis).
  let personId: string | undefined;
  if (apolloOrgId) {
    const teasers = await apollo.searchDecisionMakers({
      orgId: apolloOrgId,
      titles: SEARCH_TITLES,
      perPage: 25,
    });
    const match = teasers.find(
      (t) => (t.first_name ?? '').toLowerCase() === firstName.toLowerCase(),
    );
    personId = match?.id;
  }

  // 1 crédito (lo trackea matchPerson en api_usage).
  const person = await apollo.matchPerson({
    ...(personId ? { personId } : { firstName, organizationName: c.companies?.name ?? '' }),
    venture,
    operation,
  });

  if (!person) return { status: 'person_not_found', credits: 1 };
  if (!person.email) {
    await db.from('contacts').update({ contact_source: NO_EMAIL_SOURCE }).eq('id', contactId);
    return { status: 'no_email', credits: 1 };
  }

  const { error: uErr } = await db
    .from('contacts')
    .update({
      email: person.email,
      linkedin_url: person.linkedin_url ?? null,
      name: person.name ?? c.name,
      role: person.title ?? c.role ?? null,
      contact_source: 'apollo (unlocked)',
    })
    .eq('id', contactId);
  if (uErr) throw new Error(`update contact: ${uErr.message}`);

  return {
    status: 'revealed',
    email: person.email,
    name: person.name ?? null,
    linkedin_url: person.linkedin_url ?? null,
    credits: 1,
  };
}

/** Revela y guarda el email del contacto. Devuelve el email o null si Apollo no lo tiene. */
export async function revealContactEmail(db: DbClient, contactId: string): Promise<string | null> {
  const r = await revealContact(db, contactId);
  return r.status === 'revealed' ? r.email : null;
}

type CandidateCompany = {
  id: string;
  name: string;
  apollo_id: string | null;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    is_decision_maker: boolean | null;
    contact_source: string | null;
  }> | null;
};

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

export interface RevealCandidate {
  contactId: string;
  contactName: string;
  companyName: string;
  hasApolloOrgId: boolean;
}

export interface RevealCandidates {
  candidates: RevealCandidate[];
  /** Companies que no se intentan revelar, con el motivo. */
  skipped: Array<{ companyName: string; reason: RevealFailureReason }>;
  /** Companies que ya tienen algún contacto con email (no hace falta revelar). */
  withEmail: number;
}

/**
 * Contactos a revelar para el venture, de companies `qualified` donde NINGÚN contacto
 * tiene email. Se elige con el mismo criterio que generate-messages (`selectEmailContact`):
 * si algún contacto ya tiene email no se gasta crédito. Sin `force`, se saltean las
 * companies con draft de email pendiente (generate-messages no las va a regenerar).
 */
export async function findRevealCandidates(
  db: DbClient,
  venture: Venture,
  opts: { max?: number; force?: boolean } = {},
): Promise<RevealCandidates> {
  const max = opts.max ?? MAX_REVEALS_PER_RUN;
  const { data, error } = await db
    .from('companies')
    .select('id, name, apollo_id, contacts(id, name, email, is_decision_maker, contact_source)')
    .eq('stage', 'qualified')
    .eq('venture', venture)
    .limit(50);
  if (error) throw new Error(`fetch companies: ${error.message}`);
  const companies = (data as unknown as CandidateCompany[]) ?? [];
  const out: RevealCandidates = { candidates: [], skipped: [], withEmail: 0 };
  if (companies.length === 0) return out;

  const haveDraft = new Set<string>();
  if (!opts.force) {
    const { data: msgs } = await db
      .from('messages')
      .select('company_id')
      .eq('channel', 'email')
      .eq('status', 'draft')
      .in(
        'company_id',
        companies.map((c) => c.id),
      );
    for (const m of (msgs as Array<{ company_id: string }> | null) ?? [])
      haveDraft.add(m.company_id);
  }

  for (const co of companies) {
    if (haveDraft.has(co.id)) continue;
    const { contact, hasEmail } = selectEmailContact(co.contacts);
    if (!contact) {
      out.skipped.push({ companyName: co.name, reason: 'sin_contactos' });
      continue;
    }
    if (hasEmail) {
      out.withEmail++;
      continue;
    }
    if (contact.contact_source === NO_EMAIL_SOURCE) {
      out.skipped.push({ companyName: co.name, reason: 'apollo_sin_email_previo' });
      continue;
    }
    if (out.candidates.length >= max) {
      out.skipped.push({ companyName: co.name, reason: 'tope_reveals' });
      continue;
    }
    out.candidates.push({
      contactId: contact.id,
      contactName: contact.name,
      companyName: co.name,
      hasApolloOrgId: Boolean(co.apollo_id),
    });
  }
  return out;
}

export interface RevealFailure {
  company: string;
  contact: string | null;
  reason: RevealFailureReason;
  detail?: string;
}

export interface RevealBatchSummary {
  attempted: number;
  revealed: number;
  credits: number;
  failed: number;
  /** Detalle por company de por qué quedó sin email (incluye las no intentadas). */
  failures: RevealFailure[];
}

/** Auto-reveal en paralelo (para entrar en el timeout de Vercel) con tope MAX_REVEALS_PER_RUN. */
export async function revealEmailsForVenture(
  db: DbClient,
  venture: Venture,
  opts: { max?: number; force?: boolean } = {},
): Promise<RevealBatchSummary> {
  const max = Math.min(opts.max ?? MAX_REVEALS_PER_RUN, MAX_REVEALS_PER_RUN);
  const { candidates, skipped } = await findRevealCandidates(db, venture, {
    max,
    ...(opts.force ? { force: true } : {}),
  });
  const results = await Promise.allSettled(
    candidates.map((c) => revealContact(db, c.contactId, 'auto-reveal')),
  );
  const summary: RevealBatchSummary = {
    attempted: candidates.length,
    revealed: 0,
    credits: 0,
    failed: 0,
    failures: skipped.map((s) => ({ company: s.companyName, contact: null, reason: s.reason })),
  };
  results.forEach((r, i) => {
    const cand = candidates[i]!;
    const fail = (reason: RevealFailureReason, detail?: string) => {
      summary.failed++;
      summary.failures.push({
        company: cand.companyName,
        contact: cand.contactName,
        reason,
        ...(detail ? { detail } : {}),
      });
    };
    if (r.status === 'rejected') {
      fail('error', String(r.reason).slice(0, 200));
      return;
    }
    summary.credits += r.value.credits;
    switch (r.value.status) {
      case 'revealed':
        summary.revealed++;
        break;
      case 'person_not_found':
        fail(cand.hasApolloOrgId ? 'apollo_sin_match' : 'sin_apollo_id');
        break;
      case 'no_email':
        fail('apollo_sin_email');
        break;
      case 'contact_not_found':
        fail('contacto_no_encontrado');
        break;
    }
  });
  for (const f of summary.failures) {
    console.warn(
      `[auto-reveal] ${venture} ${f.company}${f.contact ? ` (${f.contact})` : ''}: ${REVEAL_REASON_LABELS[f.reason]}${f.detail ? ` — ${f.detail}` : ''}`,
    );
  }
  return summary;
}

/** "2 Apollo sin match, 1 sin contactos" a partir de los fallos del reveal. */
export function formatRevealReasons(failures: ReadonlyArray<{ reason: string }>): string {
  const counts = new Map<string, number>();
  for (const f of failures) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, n]) => `${n} ${REVEAL_REASON_LABELS[reason as RevealFailureReason] ?? reason}`)
    .join(', ');
}
