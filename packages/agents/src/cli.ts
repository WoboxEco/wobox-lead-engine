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
  .description('Encadena search -> enrich -> score -> check-warm-path para un venture')
  .option('--venture <venture>', 'wobox_food | wobox_fashion | loop (default: loop)')
  .option('--subsector <sub>', 'Subsector para search (loop only): cafeteria, gym, etc.')
  .option('--city <city>', 'Ciudad para search (default: Buenos Aires)')
  .option('--neighborhood <barrio>', 'Barrio especifico')
  .option('--campaign <name>', 'Nombre de campana')
  .option('--limit <n>', 'Limite por fase', (v) => parseInt(v, 10))
  .option('--skip-search', 'No hacer search-leads-web')
  .option('--skip-enrich', 'No hacer enrich-lead')
  .option('--skip-score', 'No hacer score-leads')
  .option('--skip-warm', 'No hacer check-warm-path')
  .option('--auto-reveal', 'Habilita reveal pagado en Apollo (default: false)')
  .option('--auto-min-score <n>', 'Score minimo para reveal (default: 70)', (v) => parseInt(v, 10))
  .option('--model <alias>', 'Override modelo Claude: haiku | sonnet | opus')
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
