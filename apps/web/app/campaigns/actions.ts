'use server';

import { VENTURES, createAdminClient } from '@wobox/core';
import { revalidatePath } from 'next/cache';

export async function createCampaign(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const venture = String(formData.get('venture') ?? '').trim();
  const verticalFocus = String(formData.get('vertical_focus') ?? '').trim();
  const regionFocus = String(formData.get('region_focus') ?? '').trim();
  const approachStrategy = String(formData.get('approach_strategy') ?? '').trim();

  if (!name) throw new Error('name requerido');
  if (!VENTURES.includes(venture as (typeof VENTURES)[number])) {
    throw new Error(`venture invalido: ${venture}`);
  }

  const db = createAdminClient();
  const payload: Record<string, unknown> = { name, venture, status: 'active' };
  if (verticalFocus) payload.vertical_focus = verticalFocus;
  if (regionFocus) payload.region_focus = regionFocus;
  if (approachStrategy) payload.approach_strategy = approachStrategy;

  const { error } = await db.from('campaigns').insert(payload);
  if (error) throw new Error(error.message);

  revalidatePath('/campaigns');
}

export async function setCampaignStatus(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['active', 'paused', 'completed'].includes(status)) {
    throw new Error('params invalidos');
  }

  const db = createAdminClient();
  const update: Record<string, unknown> = { status };
  if (status === 'completed') update.ended_at = new Date().toISOString();

  const { error } = await db.from('campaigns').update(update).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/campaigns');
}
