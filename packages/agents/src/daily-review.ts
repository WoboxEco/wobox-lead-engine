import { type DailySummary, buildDailySummary, createAdminClient, parsePeriod } from '@wobox/core';

export interface DailyReviewOptions {
  venture?: string;
  period?: string;
  json?: boolean;
}

export async function run(opts: DailyReviewOptions): Promise<void> {
  const db = createAdminClient();
  const hours = parsePeriod(opts.period ?? '1d');
  const summary = await buildDailySummary(db, hours, opts.venture ?? null);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  printSummary(summary);
}

function printSummary(s: DailySummary): void {
  console.log(
    `\nDaily review  (ventana: ${s.window_hours}h${s.venture_filter ? ` · venture=${s.venture_filter}` : ''})`,
  );
  console.log('='.repeat(60));

  console.log(`En las ultimas ${s.window_hours}h:`);
  console.log(`  Nuevas companies:     ${s.new_companies}`);
  console.log(`  Mensajes enviados:    ${s.messages_sent}`);
  console.log(`  Meetings booked:      ${s.meetings_booked}`);
  console.log(`  Replies:              ${s.replies}`);

  console.log('\nAccion pendiente:');
  console.log(`  Drafts por aprobar:   ${s.drafts_pending}`);
  console.log(`  Nurture hoy:          ${s.nurture_today}`);
  console.log(`  Qualified vigentes:   ${s.qualified_without_contact}`);

  console.log('\nBreakdown por venture:');
  const headers = ['venture', 'new', 'qualified', 'nurturing', 'booked', 'drafts'];
  console.log(headers.map((h, i) => (i === 0 ? h.padEnd(16) : h.padStart(11))).join(''));
  console.log('-'.repeat(60));
  for (const [v, b] of Object.entries(s.by_venture).sort(([a], [c]) => a.localeCompare(c))) {
    console.log(
      v.padEnd(16) +
        String(b.new_companies).padStart(11) +
        String(b.qualified).padStart(11) +
        String(b.nurturing).padStart(11) +
        String(b.meeting_booked).padStart(11) +
        String(b.drafts).padStart(11),
    );
  }
}
