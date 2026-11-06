'use server';

import { createAdminClient } from '@wobox/core';
import { revalidatePath } from 'next/cache';

const NURTURE_DAYS = 90;

type ReplyRef = { id: string; company_id: string };

async function loadReply(formData: FormData): Promise<ReplyRef> {
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('missing id');
  const db = createAdminClient();
  const { data, error } = await db.from('replies').select('id, company_id').eq('id', id).single();
  if (error || !data) throw new Error(`Reply ${id} no existe`);
  return data as unknown as ReplyRef;
}

async function markHandled(replyId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from('replies')
    .update({ handled: true, handled_at: new Date().toISOString() })
    .eq('id', replyId);
  if (error) throw new Error(error.message);
}

async function updateCompany(companyId: string, update: Record<string, unknown>): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from('companies')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', companyId);
  if (error) throw new Error(error.message);
}

function revalidate(): void {
  revalidatePath('/inbox');
  revalidatePath('/pipeline');
  revalidatePath('/');
}

/** El lead acepto: meeting_booked (sync-hubspot lo empuja en la proxima corrida). */
export async function replyMeetingBooked(formData: FormData): Promise<void> {
  const reply = await loadReply(formData);
  await updateCompany(reply.company_id, { stage: 'meeting_booked' });
  await markHandled(reply.id);
  revalidate();
}

/** "Ahora no": descartado con reactivation_date (+3 meses); el cron reactivate-discarded lo levanta. */
export async function replyNurtureLater(formData: FormData): Promise<void> {
  const reply = await loadReply(formData);
  const reactivation = new Date(Date.now() + NURTURE_DAYS * 24 * 60 * 60 * 1000);
  await updateCompany(reply.company_id, {
    stage: 'discarded',
    reactivation_date: reactivation.toISOString(),
    paused_reason: 'nurture_3_meses',
  });
  await markHandled(reply.id);
  revalidate();
}

export async function replyDiscard(formData: FormData): Promise<void> {
  const reply = await loadReply(formData);
  await updateCompany(reply.company_id, { stage: 'discarded', reactivation_date: null });
  await markHandled(reply.id);
  revalidate();
}

export async function replyMarkHandled(formData: FormData): Promise<void> {
  const reply = await loadReply(formData);
  await markHandled(reply.id);
  revalidate();
}
