'use server';

import { revalidatePath } from 'next/cache';
import { searchLeads, scoreLeads, generateMessages } from '@wobox/skills';

const VENTURES = new Set(['wobox_food', 'wobox_fashion', 'loop']);
const CHANNELS = new Set(['instagram_dm', 'email', 'linkedin', 'whatsapp']);

/** Genera drafts (batch) para los qualified del venture elegido. */
export async function generateMessagesAction(formData: FormData): Promise<string> {
  const venture = String(formData.get('venture') ?? '');
  const channel = String(formData.get('channel') ?? 'instagram_dm');
  if (!VENTURES.has(venture)) return 'Venture inválido';
  if (!CHANNELS.has(channel)) return 'Canal inválido';

  try {
    await generateMessages.run({ all: true, venture, channel });
  } catch (e) {
    return `Error: ${String(e).slice(0, 200)}`;
  }

  revalidatePath('/drafts');
  revalidatePath('/pipeline');
  return 'Listo (ver /drafts)';
}

/** Sourcing nuevos leads (Apollo) + scoring, para el venture elegido. */
export async function prospectAction(formData: FormData): Promise<string> {
  const venture = String(formData.get('venture') ?? '');
  const limitRaw = Number.parseInt(String(formData.get('limit') ?? '25'), 10);
  if (!VENTURES.has(venture)) return 'Venture inválido';
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 25;

  try {
    await searchLeads.run({ venture, limit: String(limit) });
  } catch (e) {
    return `Error en sourcing: ${String(e).slice(0, 200)}`;
  }

  try {
    await scoreLeads.run({ all: true, venture, limit: String(limit) });
  } catch (e) {
    return `Error en scoring: ${String(e).slice(0, 200)}`;
  }

  revalidatePath('/pipeline');
  revalidatePath('/');
  return 'Sourcing + scoring completado. Ver pipeline.';
}
