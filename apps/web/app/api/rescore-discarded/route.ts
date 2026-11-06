import { rescoreDiscarded } from '@wobox/skills';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

// Re-puntuar descartados de wobox_fashion (scoring v2). Sin `ids`: planifica (devuelve los IDs
// candidatos). Con `ids` (máx MAX_RESCORE_IDS_PER_REQUEST): los re-puntúa. El cliente llama en
// loop para no pasar el timeout de Vercel Hobby.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    if (body.ids === undefined) {
      const plan = await rescoreDiscarded.planRescore();
      return NextResponse.json(plan);
    }
    const max = rescoreDiscarded.MAX_RESCORE_IDS_PER_REQUEST;
    if (
      !Array.isArray(body.ids) ||
      body.ids.length === 0 ||
      body.ids.length > max ||
      !body.ids.every((id) => typeof id === 'string')
    ) {
      return NextResponse.json({ error: `ids inválidos (1 a ${max})` }, { status: 400 });
    }
    const r = await rescoreDiscarded.rescoreIds(body.ids as string[]);
    revalidatePath('/pipeline');
    revalidatePath('/');
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
}
