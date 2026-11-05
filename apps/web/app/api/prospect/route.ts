import { NextResponse } from 'next/server';
import { runProspectSourcing } from '../../pipeline/prospect-actions';

// Sourcing (Apollo: hasta 3 páginas + inserts + decision-makers). El scoring va aparte
// (/api/score-leads, por lotes desde el cliente) para no pasar el timeout.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const r = await runProspectSourcing(body);
    if ('error' in r) return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
