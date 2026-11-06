import { timingSafeEqual } from 'node:crypto';
import { createAdminClient, env } from '@wobox/core';
import { dailyFollowup } from '@wobox/skills';
import { NextResponse } from 'next/server';

// Vercel Cron (ver apps/web/vercel.json) llama GET con `Authorization: Bearer $CRON_SECRET`.
// El trabajo respeta CRON_TIME_BUDGET_MS (default 9s, Hobby corta a los 10s por default).
// maxDuration deja margen si se sube el presupuesto (Hobby permite configurarlo hasta 60s).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await dailyFollowup.runDailyFollowup(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
