import type { DbClient, Venture } from '@wobox/core';
import { apollo } from '@wobox/integrations';

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
  contacts: Array<{
    id: string;
    email: string | null;
    is_decision_maker: boolean | null;
    contact_source: string | null;
  }> | null;
};

/**
 * Contactos a revelar para el venture: decision-maker (mismo criterio que generate-messages)
 * de companies `qualified`, sin email, sin draft de email pendiente y no marcados como
 * "sin email" en un intento anterior.
 */
export async function findRevealCandidates(
  db: DbClient,
  venture: Venture,
  max = MAX_REVEALS_PER_RUN,
): Promise<string[]> {
  const { data, error } = await db
    .from('companies')
    .select('id, contacts(id, email, is_decision_maker, contact_source)')
    .eq('stage', 'qualified')
    .eq('venture', venture)
    .limit(50);
  if (error) throw new Error(`fetch companies: ${error.message}`);
  const companies = (data as unknown as CandidateCompany[]) ?? [];
  if (companies.length === 0) return [];

  const { data: msgs } = await db
    .from('messages')
    .select('company_id')
    .eq('channel', 'email')
    .eq('status', 'draft')
    .in(
      'company_id',
      companies.map((c) => c.id),
    );
  const haveDraft = new Set(
    ((msgs as Array<{ company_id: string }> | null) ?? []).map((m) => m.company_id),
  );

  const out: string[] = [];
  for (const co of companies) {
    if (out.length >= max) break;
    if (haveDraft.has(co.id)) continue;
    const contacts = co.contacts ?? [];
    const dm = contacts.find((c) => c.is_decision_maker) ?? contacts[0];
    if (!dm) continue;
    if ((dm.email ?? '').trim()) continue;
    if (dm.contact_source === NO_EMAIL_SOURCE) continue;
    out.push(dm.id);
  }
  return out;
}

export interface RevealBatchSummary {
  attempted: number;
  revealed: number;
  credits: number;
  failed: number;
}

/** Auto-reveal en paralelo (para entrar en el timeout de Vercel) con tope MAX_REVEALS_PER_RUN. */
export async function revealEmailsForVenture(
  db: DbClient,
  venture: Venture,
  max = MAX_REVEALS_PER_RUN,
): Promise<RevealBatchSummary> {
  const ids = await findRevealCandidates(db, venture, Math.min(max, MAX_REVEALS_PER_RUN));
  const results = await Promise.allSettled(ids.map((id) => revealContact(db, id, 'auto-reveal')));
  const summary: RevealBatchSummary = { attempted: ids.length, revealed: 0, credits: 0, failed: 0 };
  for (const r of results) {
    if (r.status === 'rejected') {
      summary.failed++;
      continue;
    }
    summary.credits += r.value.credits;
    if (r.value.status === 'revealed') summary.revealed++;
  }
  return summary;
}
