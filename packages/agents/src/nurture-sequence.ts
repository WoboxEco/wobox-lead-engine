import { VENTURES } from '@wobox/core';
import { nurtureSequence } from '@wobox/skills';

export interface NurtureSequenceAgentOptions {
  venture?: string;
  limit?: number;
  dryRun?: boolean;
  model?: string;
}

// Wrapper del scheduler: itera todas las ventures (o una) y reporta total.
// Preparado para cron diario.
export async function run(opts: NurtureSequenceAgentOptions = {}): Promise<void> {
  const started = Date.now();
  const ventures: string[] = opts.venture ? [opts.venture] : [...VENTURES];

  console.log(`\n=== nurture-sequence agent (ventures: ${ventures.join(', ')}) ===\n`);

  for (const v of ventures) {
    console.log(`\n--- ${v} ---`);
    try {
      await nurtureSequence.run({
        venture: v,
        ...(typeof opts.limit === 'number' ? { limit: opts.limit } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      });
    } catch (err) {
      console.log(`[${v}] ERROR: ${String(err)}`);
    }
  }

  console.log(`\nTotal: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
