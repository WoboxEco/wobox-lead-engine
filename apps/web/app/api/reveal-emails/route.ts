import { type Venture, createAdminClient } from '@wobox/core';
import { revealEmail } from '@wobox/skills';
import { NextResponse } from 'next/server';

// Los reveals corren en paralelo (máx MAX_REVEALS_PER_RUN), pero damos margen por si Apollo tarda.
export const maxDuration = 60;

const VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);

/** Auto-reveal de emails (Apollo, 1 crédito c/u) para los qualified del venture sin email.
 *  Lo llama el cliente antes de generar drafts de email, fuera de la server action. */
export async function POST(req: Request) {
  try {
    const { venture } = (await req.json()) as { venture?: string };
    if (!venture || !VENTURES.has(venture as Venture)) {
      return NextResponse.json({ error: 'Venture inválido' }, { status: 400 });
    }
    const db = createAdminClient();
    const summary = await revealEmail.revealEmailsForVenture(db, venture as Venture);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
