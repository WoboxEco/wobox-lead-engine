'use server';

import { type Venture, createAdminClient } from '@wobox/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';

const VALID_VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);

const DEAL_STAGES = new Set([
  'deal_sin_contacto',
  'deal_contacto',
  'deal_presentacion',
  'deal_negociacion',
  'deal_onboarding',
  'deal_ganado',
  'deal_perdido',
]);

// Alta manual de un partner de negocio, equivalente a lo que el sales team cargaba
// a mano en HubSpot: empresa + contacto opcional, entra directo al deal pipeline
// (no pasa por el funnel de prospeccion, source='manual' la distingue de hubspot_import).
export async function createManualDeal(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const venture = String(formData.get('venture') ?? '');
  const stage = String(formData.get('stage') ?? 'deal_sin_contacto');
  const subsector = String(formData.get('subsector') ?? '').trim() || null;
  const region = String(formData.get('region') ?? '').trim();
  const neighborhood = String(formData.get('neighborhood') ?? '').trim() || null;
  const instagramHandle = normalizeInstagramHandle(String(formData.get('instagram') ?? ''));
  const website = String(formData.get('website') ?? '').trim() || null;
  const rawValue = String(formData.get('deal_value') ?? '').trim();
  const dealValue = rawValue ? Number(rawValue) : null;
  const contactName = String(formData.get('contact_name') ?? '').trim();
  const contactEmail = String(formData.get('contact_email') ?? '').trim();
  const contactPhone = String(formData.get('contact_phone') ?? '').trim();

  if (!name) throw new Error('Falta el nombre de la empresa');
  if (!VALID_VENTURES.has(venture as Venture)) throw new Error(`venture invalido: ${venture}`);
  if (!DEAL_STAGES.has(stage)) throw new Error(`stage invalido: ${stage}`);
  if (!region) throw new Error('Falta la ciudad');
  if (!contactName) throw new Error('Falta el nombre del contacto');
  if (!contactEmail) throw new Error('Falta el email del contacto');
  if (!contactPhone) throw new Error('Falta el telefono del contacto');

  const supabaseSession = await createSupabaseServerClient();
  const {
    data: { user: creator },
  } = await supabaseSession.auth.getUser();

  const db = createAdminClient();
  const { data, error } = await db
    .from('companies')
    .insert({
      name,
      venture,
      subsector,
      region,
      neighborhood,
      instagram_handle: instagramHandle,
      website,
      deal_value: dealValue && Number.isFinite(dealValue) ? dealValue : null,
      stage,
      source: 'manual',
      stage_entered_at: new Date().toISOString(),
      assigned_to: creator?.id ?? null,
    } as never)
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'insert company fallo');
  const companyId = (data as { id: string }).id;

  const { error: contactErr } = await db.from('contacts').insert({
    company_id: companyId,
    name: contactName,
    role: String(formData.get('contact_role') ?? '').trim() || null,
    email: contactEmail.toLowerCase(),
    phone: contactPhone,
    contact_source: 'manual',
    is_decision_maker: false,
  } as never);
  if (contactErr) throw new Error(contactErr.message);

  revalidatePath('/crm');
  redirect(`/crm?venture=${venture}`);
}

export async function setOwner(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const userId = String(formData.get('user_id') ?? '');
  if (!companyId || !userId) throw new Error('missing company_id/user_id');

  const db = createAdminClient();
  const { error } = await db
    .from('companies')
    .update({ assigned_to: userId, updated_at: new Date().toISOString() })
    .eq('id', companyId);
  if (error) throw new Error(error.message);

  revalidatePath('/crm');
  revalidatePath(`/crm/${companyId}`);
}

export async function addCoOwner(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const userId = String(formData.get('user_id') ?? '');
  if (!companyId || !userId) throw new Error('missing company_id/user_id');

  const db = createAdminClient();
  const { error } = await db
    .from('company_co_owners')
    .upsert({ company_id: companyId, user_id: userId } as never, {
      onConflict: 'company_id,user_id',
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);

  revalidatePath(`/crm/${companyId}`);
}

export async function removeCoOwner(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const userId = String(formData.get('user_id') ?? '');
  if (!companyId || !userId) throw new Error('missing company_id/user_id');

  const db = createAdminClient();
  const { error } = await db
    .from('company_co_owners')
    .delete()
    .eq('company_id', companyId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  revalidatePath(`/crm/${companyId}`);
}

// Handoff programado: no cambia el owner ahora — queda pendiente hasta effective_date,
// cuando el cron 'apply-ownership-handoffs' (0007_ownership.sql) lo aplica solo.
export async function scheduleHandoff(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const toUserId = String(formData.get('to_user_id') ?? '');
  const effectiveDate = String(formData.get('effective_date') ?? '');
  const reason = String(formData.get('reason') ?? '').trim() || null;
  if (!companyId || !toUserId || !effectiveDate) {
    throw new Error('Falta el usuario destino o la fecha');
  }

  const db = createAdminClient();
  const { data: company } = await db
    .from('companies')
    .select('assigned_to')
    .eq('id', companyId)
    .single();
  const fromUserId = (company as { assigned_to: string | null } | null)?.assigned_to ?? null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await db.from('ownership_handoffs').insert({
    company_id: companyId,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    effective_date: effectiveDate,
    reason,
    created_by: user?.id ?? null,
  } as never);
  if (error) throw new Error(error.message);

  revalidatePath(`/crm/${companyId}`);
}

// Ciudad/Barrio/Instagram — editable en el detail, no solo al crear la company.
export async function updateCompanyDetails(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const region = String(formData.get('region') ?? '').trim();
  const neighborhood = String(formData.get('neighborhood') ?? '').trim() || null;
  const instagramHandle = normalizeInstagramHandle(String(formData.get('instagram') ?? ''));
  if (!companyId) throw new Error('missing company_id');
  if (!region) throw new Error('Falta la ciudad');

  const db = createAdminClient();
  const { error } = await db
    .from('companies')
    .update({
      region,
      neighborhood,
      instagram_handle: instagramHandle,
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId);
  if (error) throw new Error(error.message);

  revalidatePath(`/crm/${companyId}`);
}

export async function addNote(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!companyId || !body) throw new Error('Falta el contenido de la nota');

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const db = createAdminClient();
  const { error } = await db.from('interactions').insert({
    company_id: companyId,
    type: 'note',
    channel: 'internal',
    content: body,
    ai_generated: false,
    outcome: 'pending',
    performed_by: user?.id ?? null,
  } as never);
  if (error) throw new Error(error.message);

  revalidatePath(`/crm/${companyId}`);
}

const FOLLOWUP_3D = 'Follow-up (3 dias desde primer contacto)';
const FOLLOWUP_7D = 'Follow-up (7 dias desde primer contacto)';

// Guarda la fecha de primer contacto y (re)genera las dos tasks de seguimiento a
// 3 y 7 dias. Si ya existian (fecha editada), se borran y se recrean con la fecha
// nueva — evita duplicados por reprogramar.
export async function setFirstContactDate(formData: FormData): Promise<void> {
  const companyId = String(formData.get('company_id') ?? '');
  const dateStr = String(formData.get('first_contact_date') ?? '');
  if (!companyId || !dateStr) throw new Error('Falta la fecha de primer contacto');

  const db = createAdminClient();
  const { error } = await db
    .from('companies')
    .update({ first_contact_date: dateStr, updated_at: new Date().toISOString() })
    .eq('id', companyId);
  if (error) throw new Error(error.message);

  await db
    .from('tasks')
    .delete()
    .eq('company_id', companyId)
    .in('title', [FOLLOWUP_3D, FOLLOWUP_7D]);

  const base = new Date(`${dateStr}T00:00:00Z`);
  const plus = (days: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const { data: company } = await db
    .from('companies')
    .select('assigned_to')
    .eq('id', companyId)
    .single();
  const owner = (company as { assigned_to: string | null } | null)?.assigned_to ?? null;

  const { error: taskErr } = await db.from('tasks').insert([
    { company_id: companyId, title: FOLLOWUP_3D, due_date: plus(3), owner },
    { company_id: companyId, title: FOLLOWUP_7D, due_date: plus(7), owner },
  ] as never);
  if (taskErr) throw new Error(taskErr.message);

  revalidatePath(`/crm/${companyId}`);
}

export async function toggleTask(formData: FormData): Promise<void> {
  const taskId = String(formData.get('task_id') ?? '');
  const companyId = String(formData.get('company_id') ?? '');
  const done = String(formData.get('done') ?? '') === 'true';
  if (!taskId) throw new Error('missing task_id');

  const db = createAdminClient();
  const { error } = await db
    .from('tasks')
    .update({ done: !done } as never)
    .eq('id', taskId);
  if (error) throw new Error(error.message);

  if (companyId) revalidatePath(`/crm/${companyId}`);
}

function normalizeInstagramHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}
