'use server';

import type { Channel, Venture } from '@wobox/core';
import { generateMessages, scoreLeads, searchLeads, searchLeadsWeb } from '@wobox/skills';
import { revalidatePath } from 'next/cache';

const VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);
const CHANNELS = new Set<Channel>(['instagram_dm', 'email', 'linkedin', 'whatsapp', 'phone']);
const FASHION_SUBSECTORS = new Set(['ropa', 'calzado', 'muebles_deco', 'todos']);

/** Genera drafts (batch) para los qualified del venture elegido. */
export async function generateMessagesAction(formData: FormData): Promise<string> {
  const venture = String(formData.get('venture') ?? '') as Venture;
  const channel = String(formData.get('channel') ?? 'email') as Channel;
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

/** Sourcing nuevos leads + scoring, para el venture elegido.
 *  Loop usa Apify (search-leads-web); food/fashion usan Apollo (search-leads).
 */
export async function prospectAction(formData: FormData): Promise<string> {
  const venture = String(formData.get('venture') ?? '') as Venture;
  const limitRaw = Number.parseInt(String(formData.get('limit') ?? '25'), 10);
  if (!VENTURES.has(venture)) return 'Venture inválido';
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 25;
  const subsectorRaw = String(formData.get('subsector') ?? '').trim();
  let subsector: string | undefined;
  if (venture === 'wobox_fashion' && subsectorRaw) {
    if (!FASHION_SUBSECTORS.has(subsectorRaw)) return 'Rubro inválido';
    subsector = subsectorRaw;
  }

  try {
    if (venture === 'loop') {
      await searchLeadsWeb.run({ limit: String(limit) });
    } else {
      await searchLeads.run({ venture, limit: String(limit), ...(subsector ? { subsector } : {}) });
    }
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
