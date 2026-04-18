#!/usr/bin/env tsx
import { Command } from 'commander';
import { logger } from '@wobox/core';

import * as setupDatabase from './setup-database.js';
import * as scoreLeads from './score-leads.js';
import * as searchLeads from './search-leads.js';
import * as searchLeadsWeb from './search-leads-web.js';
import * as importCsv from './import-csv.js';
import * as enrichLead from './enrich-lead.js';
import * as checkWarmPath from './check-warm-path.js';
import * as generateMessages from './generate-messages.js';
import * as syncHubspot from './sync-hubspot.js';
import * as showPipeline from './show-pipeline.js';
import * as showMetrics from './show-metrics.js';
import * as approveMessage from './approve-message.js';

const program = new Command();

program.name('skill').description('CLI para correr skills de Wobox Lead Engine').version('0.1.0');

program.command('setup-database').description('Corre migrations contra Supabase').action(setupDatabase.run);

program
  .command('score-leads')
  .description('Scorea leads con el modelo correcto segun venture')
  .option('--venture <venture>', 'wobox_food | wobox_fashion | loop')
  .option('--id <uuid>', 'Scorear 1 company especifica')
  .option('--all', 'Scorear todas las companies en stage new|enriched')
  .option('--limit <n>', 'Limite de companies a procesar', '10')
  .action(scoreLeads.run);

program.command('search-leads').description('[stub] Apollo search para Wobox + cadenas Loop').action(searchLeads.run);
program.command('search-leads-web').description('[stub] Apify/web search para Loop locales').action(searchLeadsWeb.run);
program.command('import-csv').description('[stub] Import bulk desde CSV').action(importCsv.run);
program.command('enrich-lead').description('[stub] Instagram + web enrichment').action(enrichLead.run);
program.command('check-warm-path').description('[stub] Detecta warm paths via Apollo').action(checkWarmPath.run);
program.command('generate-messages').description('[stub] Genera mensajes via Claude').action(generateMessages.run);
program.command('sync-hubspot').description('[stub] Push meeting_booked a HubSpot').action(syncHubspot.run);
program.command('show-pipeline').description('[stub] Vista Kanban filtrable').action(showPipeline.run);
program.command('show-metrics').description('[stub] KPIs por venture').action(showMetrics.run);
program.command('approve-message').description('[stub] Aprobar/editar/descartar drafts').action(approveMessage.run);

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'skill failed');
  process.exit(1);
});
