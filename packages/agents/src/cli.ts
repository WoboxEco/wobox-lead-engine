#!/usr/bin/env tsx
import { logger } from '@wobox/core';
import { Command } from 'commander';

import * as campaignReport from './campaign-report.js';
import * as dailyReview from './daily-review.js';
import * as fullProspecting from './full-prospecting.js';
import * as nurtureSequence from './nurture-sequence.js';

const program = new Command();
program.name('agent').description('Orquestadores de flujos completos').version('0.1.0');

program
  .command('full-prospecting')
  .description('[stub] search -> enrich -> score -> warm -> messages')
  .action(fullProspecting.run);
program
  .command('nurture-sequence')
  .description('[stub] Nurture scheduler diario')
  .action(nurtureSequence.run);
program
  .command('daily-review')
  .description('[stub] Resumen diario cross-venture')
  .action(dailyReview.run);
program
  .command('campaign-report')
  .description('[stub] Analytics por campana')
  .action(campaignReport.run);

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'agent failed');
  process.exit(1);
});
