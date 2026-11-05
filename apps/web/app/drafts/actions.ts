'use server';

import { createAdminClient } from '@wobox/core';
import { deliver } from '@wobox/skills';
import { revalidatePath } from 'next/cache';

type MessageRow = {
  id: string;
  company_id: string;
  contact_id: string;
  approach_type: string;
  channel: string;
  subject: string | null;
  body: string;
  original_body: string;
  status: string;
};

const STAGE_ORDER = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
];

async function loadMessage(id: string): Promise<MessageRow> {
  const db = createAdminClient();
  const { data, error } = await db
    .from('messages')
    .select(
      'id, company_id, contact_id, approach_type, channel, subject, body, original_body, status',
    )
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`Message ${id} no existe`);
  return data as unknown as MessageRow;
}

function assertStatus(msg: MessageRow, allowed: string[]): void {
  if (!allowed.includes(msg.status)) {
    throw new Error(`status=${msg.status} no permite esta accion`);
  }
}

function isStageDowngrade(current: string, next: string): boolean {
  const ci = STAGE_ORDER.indexOf(current);
  const ni = STAGE_ORDER.indexOf(next);
  if (ci < 0 || ni < 0) return false;
  return ni < ci;
}

export async function approveDraft(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');
  const msg = await loadMessage(id);
  assertStatus(msg, ['draft']);

  const db = createAdminClient();
  const { error } = await db.from('messages').update({ status: 'approved' }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/drafts');
  revalidatePath('/nurture');
  revalidatePath('/');
}

export async function discardDraft(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');

  const db = createAdminClient();
  const { error } = await db.from('messages').update({ status: 'discarded' }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/drafts');
  revalidatePath('/nurture');
  revalidatePath('/');
}

export async function saveEditAndApprove(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const subjectRaw = formData.get('subject');
  const subject = typeof subjectRaw === 'string' ? subjectRaw.trim() : null;

  if (!id) throw new Error('missing id');
  if (!body) throw new Error('body vacio');

  const msg = await loadMessage(id);
  assertStatus(msg, ['draft', 'approved']);

  const update: Record<string, unknown> = { body, status: 'approved' };
  if (subject !== null && msg.channel === 'email') update.subject = subject;

  const db = createAdminClient();
  const { error } = await db.from('messages').update(update).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/drafts');
  revalidatePath('/nurture');
  revalidatePath('/');
}

export type SendResult = { ok: true; to: string | null } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/** true si el error de PostgREST es porque la columna messages.sent_to no existe (migration 0009 sin aplicar). */
function isMissingSentToColumn(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST204' || err.code === '42703' || /sent_to/.test(err.message ?? '');
}

async function saveContactEmailIfChanged(
  db: ReturnType<typeof createAdminClient>,
  contactId: string,
  to: string,
): Promise<void> {
  const { data, error: loadErr } = await db
    .from('contacts')
    .select('email')
    .eq('id', contactId)
    .single();
  if (loadErr) throw new Error(`load contact: ${loadErr.message}`);
  if (normalizeEmail((data as { email: string | null } | null)?.email) === to) return;
  const { error } = await db
    .from('contacts')
    .update({ email: to, contact_source: 'manual' })
    .eq('id', contactId);
  if (error) throw new Error(`guardar email: ${error.message}`);
}

/**
 * Envía un draft. Para email, el form trae "Para:", asunto y cuerpo tal cual se ven
 * en la card: se guardan PRIMERO (contacts.email + messages.subject/body) y después se
 * entrega al destinatario explícito, así nunca se usa un email viejo del contacto.
 */
async function performSend(formData: FormData): Promise<{ to: string | null }> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');

  const msg = await loadMessage(id);
  assertStatus(msg, ['draft', 'approved']);

  const db = createAdminClient();
  let to: string | null = null;

  if (msg.channel === 'email') {
    if (!formData.has('to')) {
      throw new Error('Los emails se envían desde /drafts confirmando el destinatario ("Para:")');
    }
    to = normalizeEmail(formData.get('to'));
    if (!EMAIL_RE.test(to) || to.length > 254)
      throw new Error(`Email inválido: ${to || '(vacío)'}`);

    const subjectRaw = formData.get('subject');
    const bodyRaw = formData.get('body');
    const subject =
      typeof subjectRaw === 'string' ? subjectRaw.trim().slice(0, 200) : (msg.subject ?? '');
    const body = typeof bodyRaw === 'string' ? bodyRaw.trim() : msg.body;
    if (!subject) throw new Error('asunto vacío');
    if (!body) throw new Error('cuerpo vacío');

    // 1. Guardar destinatario en el contacto (si cambió).
    await saveContactEmailIfChanged(db, msg.contact_id, to);

    // 2. Guardar asunto/cuerpo en el mensaje.
    if (subject !== msg.subject || body !== msg.body) {
      const { error } = await db.from('messages').update({ subject, body }).eq('id', id);
      if (error) throw new Error(`guardar asunto/cuerpo: ${error.message}`);
      msg.subject = subject;
      msg.body = body;
    }
  }

  // 3. Envio real (email via SMTP) al destinatario explícito. Si falla, tira y el draft queda sin marcar.
  const delivery = await deliver.deliverMessage(db, msg, to ? { to } : {});
  if (delivery.to) to = delivery.to;

  const now = new Date().toISOString();

  let { error: msgErr } = await db
    .from('messages')
    .update({ status: 'sent', sent_at: now, sent_to: to })
    .eq('id', id);
  if (isMissingSentToColumn(msgErr)) {
    // Migration 0009 todavía no aplicada: no perder el estado sent (el mail ya salió).
    // El destinatario queda igual en interactions.metadata.sent_to.
    ({ error: msgErr } = await db
      .from('messages')
      .update({ status: 'sent', sent_at: now })
      .eq('id', id));
  }
  if (msgErr) throw new Error(msgErr.message);

  const interactionType = msg.channel === 'email' ? 'email' : 'message';
  await db.from('interactions').insert({
    contact_id: msg.contact_id,
    company_id: msg.company_id,
    type: interactionType,
    channel: msg.channel,
    content: msg.body,
    ai_generated: msg.body === msg.original_body,
    outcome: 'sent',
    performed_at: now,
    metadata: { message_id: id, sent_to: to },
  });

  const nextStage = msg.approach_type === 'nurture' ? 'nurturing' : 'contacted';
  const { data: companyData } = await db
    .from('companies')
    .select('stage')
    .eq('id', msg.company_id)
    .single();
  const currentStage = (companyData as { stage: string } | null)?.stage;

  if (currentStage && !isStageDowngrade(currentStage, nextStage)) {
    await db
      .from('companies')
      .update({ stage: nextStage, updated_at: now })
      .eq('id', msg.company_id);
  }

  revalidatePath('/drafts');
  revalidatePath('/nurture');
  revalidatePath('/pipeline');
  revalidatePath('/');
  return { to };
}

/** Envío de email desde la card (client): devuelve el destinatario usado o el error. */
export async function sendDraft(formData: FormData): Promise<SendResult> {
  try {
    const { to } = await performSend(formData);
    return { ok: true, to };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Canales manuales (LinkedIn, WhatsApp, IG...): marca como enviado. */
export async function markSentDraft(formData: FormData): Promise<void> {
  await performSend(formData);
}

/**
 * Deshace un envío: status=draft, sent_at=null, sent_to=null y borra la
 * interaction outcome=sent de ese mensaje. No toca el stage de la company.
 */
export async function revertToDraft(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');

  const db = createAdminClient();
  const { data, error: loadErr } = await db
    .from('messages')
    .select('id, contact_id, status, sent_at')
    .eq('id', id)
    .single();
  if (loadErr || !data) throw new Error(`Message ${id} no existe`);
  const msg = data as unknown as {
    id: string;
    contact_id: string;
    status: string;
    sent_at: string | null;
  };
  if (msg.status !== 'sent') throw new Error(`status=${msg.status} no permite volver a borrador`);

  let { error } = await db
    .from('messages')
    .update({ status: 'draft', sent_at: null, sent_to: null })
    .eq('id', id);
  if (isMissingSentToColumn(error)) {
    ({ error } = await db.from('messages').update({ status: 'draft', sent_at: null }).eq('id', id));
  }
  if (error) throw new Error(error.message);

  // Interactions nuevas traen metadata.message_id; las previas a este cambio se
  // matchean por contacto + outcome=sent + performed_at == sent_at.
  const { error: delErr } = await db
    .from('interactions')
    .delete()
    .eq('outcome', 'sent')
    .eq('metadata->>message_id', id);
  if (delErr) throw new Error(`borrar interaction: ${delErr.message}`);
  if (msg.sent_at) {
    await db
      .from('interactions')
      .delete()
      .eq('outcome', 'sent')
      .eq('contact_id', msg.contact_id)
      .eq('performed_at', msg.sent_at);
  }

  revalidatePath('/drafts');
  revalidatePath('/nurture');
  revalidatePath('/');
}

/**
 * Guarda "Para:", asunto y cuerpo de un draft de email sin enviarlo.
 * Con `approve=1` además lo pasa a approved.
 */
export async function saveEmailDraft(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');
  const to = normalizeEmail(formData.get('to'));
  const subject = String(formData.get('subject') ?? '')
    .trim()
    .slice(0, 200);
  const body = String(formData.get('body') ?? '').trim();
  const approve = formData.get('approve') === '1';

  const msg = await loadMessage(id);
  assertStatus(msg, ['draft', 'approved']);
  if (msg.channel !== 'email') throw new Error('solo para drafts de email');
  if (to && (!EMAIL_RE.test(to) || to.length > 254)) throw new Error(`Email inválido: ${to}`);
  if (!subject) throw new Error('asunto vacío');
  if (!body) throw new Error('cuerpo vacío');

  const db = createAdminClient();
  if (to) await saveContactEmailIfChanged(db, msg.contact_id, to);

  const update: Record<string, unknown> = { subject, body };
  if (approve) update.status = 'approved';
  const { error } = await db.from('messages').update(update).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/drafts');
  revalidatePath('/nurture');
  revalidatePath('/pipeline');
  revalidatePath('/');
}
