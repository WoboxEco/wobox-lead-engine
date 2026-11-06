import { type Venture, createAdminClient } from '@wobox/core';
import { contactChannels } from '@wobox/skills';
import { NextResponse } from 'next/server';

// Google Maps via Apify tarda 20-60s por lugar (en paralelo). Route handler en vez de
// server action para poder extender la duracion (Hobby permite hasta 60s).
export const maxDuration = 60;

const VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);

/**
 * POST /api/enrich { venture?, limit?, maps? }
 * Scrape del website + Google Maps (tope 10/corrida) para companies con enriched_at null.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      venture?: string;
      limit?: number;
      maps?: boolean;
    };
    const venture = body.venture as Venture | undefined;
    if (venture && !VENTURES.has(venture)) {
      return NextResponse.json({ error: 'Venture inválido' }, { status: 400 });
    }
    const limit =
      typeof body.limit === 'number' && body.limit > 0 && body.limit <= 100 ? body.limit : 30;

    const res = await contactChannels.enrichContactChannels(createAdminClient(), {
      ...(venture ? { venture } : {}),
      limit,
      maps: body.maps !== false,
      mapsLimit: contactChannels.DEFAULT_MAPS_LIMIT,
    });
    return NextResponse.json({
      processed: res.processed,
      updated: res.updated,
      mapsLookups: res.mapsLookups,
      pendingMaps: res.pendingMaps,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
