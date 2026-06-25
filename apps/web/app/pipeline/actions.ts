'use server';

import { createAdminClient } from '@wobox/core';
import { apollo } from '@wobox/integrations';
import { revalidatePath } from 'next/cache';

const VALID_STAGES = new Set([
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
]);

const VALID_VENTURES = new Set(['wobox_food', 'wobox_fashion', 'loop']);

export async function changeStage(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const stage = String(formData.get('stage') ?? '');
  if (!id) throw new Error('missing id');
  if (!VALID_STAGES.has(stage)) throw new Error(`stage invalido: ${stage}`);

  const db = createAdminClient();
  const { error } = await db
    .from('companies')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/pipeline');
  revalidatePath('/');
}

export async function changeVenture(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const venture = String(formData.get('venture') ?? '');
  if (!id) throw new Error('missing id');
  if (!VALID_VENTURES.has(venture)) throw new Error(`venture invalido: ${venture}`);

  const db = createAdminClient();
  const { error } = await db
    .from('companies')
    .update({ venture, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/pipeline');
  revalidatePath('/');
}

export async function unlockContact(_prev: string | null, formData: FormData): Promise<string | null> {
  const contactId = String(formData.get('contactId') ?? '');
  if (!contactId) return 'missing contactId';

  try {
    const db = createAdminClient();

    const { data: contact, error: cErr } = await db
      .from('contacts')
      .select('id, name, role, company_id, companies(name, venture, apollo_id)')
      .eq('id', contactId)
      .single();
    if (cErr || !contact) return 'Contacto no encontrado en DB';

    const c = contact as unknown as {
      id: string;
      name: string;
      role: string | null;
      company_id: string;
      companies: { name: string; venture: string; apollo_id: string | null } | null;
    };

    const venture = (c.companies?.venture ?? 'wobox_food') as 'wobox_food' | 'wobox_fashion' | 'loop';
    const apolloOrgId = c.companies?.apollo_id;

    let personId: string | undefined;
    if (apolloOrgId) {
      const teasers = await apollo.searchDecisionMakers({ orgId: apolloOrgId });
      const firstNameLower = c.name.split(' ')[0]?.toLowerCase() ?? '';
      const match = teasers.find((t) => (t.first_name ?? '').toLowerCase() === firstNameLower);
      personId = match?.id;
    }

    const firstName = c.name.split(' ')[0] ?? c.name;
    const person = await apollo.matchPerson({
      ...(personId ? { personId } : { firstName, organizationName: c.companies?.name ?? '' }),
      venture,
      operation: 'unlock-contact',
    });

    if (!person) return 'Apollo no encontró el contacto (puede no tener email público)';

    const { error: uErr } = await db
      .from('contacts')
      .update({
        email: person.email ?? null,
        linkedin_url: person.linkedin_url ?? null,
        name: person.name ?? c.name,
        role: person.title ?? c.role ?? null,
        contact_source: 'apollo (unlocked)',
      })
      .eq('id', contactId);
    if (uErr) return `DB error: ${uErr.message}`;

    revalidatePath('/pipeline');
    revalidatePath('/');
    return null;
  } catch (err) {
    return `Error inesperado: ${String(err).replace('Error: ', '').slice(0, 150)}`;
  }
}

export async function discardCompany(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');

  const db = createAdminClient();
  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

  const { error } = await db
    .from('companies')
    .update({
      stage: 'discarded',
      reactivation_date: sixMonthsFromNow.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/pipeline');
  revalidatePath('/');
}
