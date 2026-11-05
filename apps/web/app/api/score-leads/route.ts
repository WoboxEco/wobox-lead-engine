import { NextResponse } from 'next/server';
import { runProspectScoring } from '../../pipeline/prospect-actions';

// Scorea pocas companies por request (máx MAX_SCORE_IDS_PER_REQUEST); el cliente llama en loop.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const r = await runProspectScoring(body);
    if ('error' in r) return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
