'use server';

import { createAdminClient } from '@wobox/core';
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
