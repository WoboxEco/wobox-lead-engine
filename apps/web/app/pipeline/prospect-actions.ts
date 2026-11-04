'use server';

import type { Channel, Venture } from '@wobox/core';
import {
  MAX_REVEALS_PER_RUN,
  generateMessages,
  revealEmail,
  scoreLeads,
  searchLeads,
  searchLeadsWeb,
} from '@wobox/skills';
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
  // Regenerar: el skill descarta los drafts pendientes (status=draft) de cada company del
  // venture + canal recién cuando el draft nuevo quedó guardado.
  const regenerate = formData.get('regenerate') === 'true';

  // El auto-reveal de emails (Apollo, máx MAX_REVEALS_PER_RUN) corre antes en
  // /api/reveal-emails para no sumar latencia a esta server action (timeout Vercel Hobby).
  // El cliente nos pasa el resultado para armar el resumen.
  const isEmail = channel === 'email';
  const revealed = toCount(formData.get('revealed'));
  const credits = toCount(formData.get('credits'));
  const revealError = String(formData.get('revealError') ?? '').trim();
  const revealFailures = parseFailures(formData.get('revealFailures'));

  let result: Awaited<ReturnType<typeof generateMessages.run>>;
  try {
    result = await generateMessages.run({
      all: true,
      venture,
      channel,
      ...(regenerate ? { force: true } : {}),
      ...(isEmail ? { requireEmail: true } : {}),
    });
  } catch (e) {
    return `Error: ${String(e).slice(0, 200)}`;
  }

  revalidatePath('/drafts');
  revalidatePath('/pipeline');

  if (!isEmail) return `${result.ok} drafts (ver /drafts)`;
  // Las companies sin contactos van aparte (no son "sin email").
  const reasons = revealEmail.formatRevealReasons(
    revealFailures.filter((f) => f.reason !== 'sin_contactos'),
  );
  const noEmail = `${result.noEmail} sin email${result.noEmail > 0 && reasons ? ` (motivos: ${reasons})` : ''}`;
  const parts = [
    `${result.ok} drafts`,
    `${revealed} emails revelados (${credits} créditos)`,
    noEmail,
  ];
  if (result.noContacts > 0) parts.push(`${result.noContacts} sin contactos`);
  if (result.failed > 0) parts.push(`${result.failed} fallaron`);
  if (revealError) parts.push(`reveal falló: ${revealError.slice(0, 120)}`);
  return `${parts.join(', ')} (máx ${MAX_REVEALS_PER_RUN} reveals por corrida)`;
}

function parseFailures(v: FormDataEntryValue | null): Array<{ reason: string }> {
  if (typeof v !== 'string' || !v) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is { reason: string } =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as { reason?: unknown }).reason === 'string',
    );
  } catch {
    return [];
  }
}

function toCount(v: FormDataEntryValue | null): number {
  const n = Number.parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
