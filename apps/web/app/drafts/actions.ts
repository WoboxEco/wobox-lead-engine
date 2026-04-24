'use server';

import { createAdminClient } from '@wobox/core';
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

export async function sendDraft(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');

  const msg = await loadMessage(id);
  assertStatus(msg, ['draft', 'approved']);

  const db = createAdminClient();
  const now = new Date().toISOString();

  const { error: msgErr } = await db
    .from('messages')
    .update({ status: 'sent', sent_at: now })
    .eq('id', id);
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
  revalidatePath('/');
}
