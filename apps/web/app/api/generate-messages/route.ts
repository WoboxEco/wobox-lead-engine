import type { Channel, Venture } from '@wobox/core';
import { generateMessages } from '@wobox/skills';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

// Cada request genera pocos drafts (Claude ~3-8s c/u); el cliente llama en loop.
export const maxDuration = 60;

/** Máximo de companies por request (el cliente manda de a GENERATE_CHUNK_SIZE). */
const MAX_IDS_PER_REQUEST = 3;

const VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);
const CHANNELS = new Set<Channel>(['instagram_dm', 'email', 'linkedin', 'whatsapp', 'phone']);

/**
 * Generación de drafts por lotes, para no pasar el timeout de Vercel Hobby:
 *  - sin `ids`: planifica. Devuelve `pending` (companies a generar) + los skips (sin email,
 *    sin contactos), sin llamar a Claude.
 *  - con `ids` (máx 3): genera los drafts de esas companies y devuelve ok/failed/failures.
 * Regenerar (`regenerate`) descarta los drafts pendientes del canal recién al guardar el nuevo.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      venture?: string;
      channel?: string;
      regenerate?: boolean;
      ids?: unknown;
    };
    const venture = body.venture as Venture;
    const channel = (body.channel ?? 'email') as Channel;
    if (!VENTURES.has(venture))
      return NextResponse.json({ error: 'Venture inválido' }, { status: 400 });
    if (!CHANNELS.has(channel))
      return NextResponse.json({ error: 'Canal inválido' }, { status: 400 });

    let ids: string[] | undefined;
    if (body.ids !== undefined) {
      if (
        !Array.isArray(body.ids) ||
        body.ids.length > MAX_IDS_PER_REQUEST ||
        !body.ids.every((id) => typeof id === 'string')
      ) {
        return NextResponse.json(
          { error: `ids inválidos (máx ${MAX_IDS_PER_REQUEST})` },
          { status: 400 },
        );
      }
      ids = body.ids as string[];
    }

    const result = await generateMessages.run({
      all: true,
      venture,
      channel,
      ...(body.regenerate === true ? { force: true } : {}),
      ...(channel === 'email' ? { requireEmail: true } : {}),
      ...(ids ? { ids } : { planOnly: true }),
    });

    if (ids && result.ok > 0) {
      revalidatePath('/drafts');
      revalidatePath('/pipeline');
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
