#!/usr/bin/env tsx
import { logger } from '@wobox/core';
import { Command } from 'commander';

import * as approveMessage from './approve-message.js';
import * as checkWarmPath from './check-warm-path.js';
import * as enrichLead from './enrich-lead.js';
import * as generateMessages from './generate-messages.js';
import * as importCsv from './import-csv.js';
import * as scoreLeads from './score-leads.js';
import * as searchLeadsWeb from './search-leads-web.js';
import * as searchLeads from './search-leads.js';
import * as setupDatabase from './setup-database.js';
import * as showMetrics from './show-metrics.js';
import * as showPipeline from './show-pipeline.js';
import * as syncHubspot from './sync-hubspot.js';

const program = new Command();

program.name('skill').description('CLI para correr skills de Wobox Lead Engine').version('0.1.0');

program
  .command('setup-database')
  .description('Corre migrations contra Supabase')
  .action(setupDatabase.run);

program
  .command('score-leads')
  .description('Scorea leads con el modelo correcto segun venture')
  .option('--venture <venture>', 'wobox_food | wobox_fashion | loop')
  .option('--id <uuid>', 'Scorear 1 company especifica')
  .option('--all', 'Scorear todas las companies en stage new|enriched')
  .option('--limit <n>', 'Limite de companies a procesar', '10')
  .option(
    '--stages <list>',
    'Stages a scorear (CSV). Default: new,enriched. Para rescorear: new,enriched,qualified',
  )
  .option('--model <alias>', 'Override del modelo: haiku | sonnet | opus (default: haiku)')
  .action(scoreLeads.run);

program
  .command('search-leads')
  .description('[stub] Apollo search para Wobox + cadenas Loop (default: haiku)')
  .option('--model <alias>', 'Override del modelo: haiku | sonnet | opus')
  .action(searchLeads.run);
program
  .command('search-leads-web')
  .description('Apify Google Maps search para Loop locales (default: haiku)')
  .option('--subsector <sub>', 'cafeteria | peluqueria | gym | etc. (default: cafeteria)')
  .option('--city <city>', 'Ciudad (default: Buenos Aires)')
  .option('--neighborhood <barrio>', 'Barrio especifico (ej: "Palermo Soho")')
  .option('--campaign <name>', 'Asociar leads a una campana (se crea si no existe)')
  .option('--limit <n>', 'Max places por query de Apify (default: 30)')
  .option('--model <alias>', 'Override del modelo: haiku | sonnet | opus')
  .action(searchLeadsWeb.run);
program.command('import-csv').description('[stub] Import bulk desde CSV').action(importCsv.run);
program
  .command('enrich-lead')
  .description('[stub] Instagram + web enrichment (default: haiku)')
  .option('--model <alias>', 'Override del modelo: haiku | sonnet | opus')
  .action(enrichLead.run);
program
  .command('check-warm-path')
  .description('[stub] Detecta warm paths via Apollo')
  .action(checkWarmPath.run);
program
  .command('generate-messages')
  .description('Genera mensaje draft via Claude (default: sonnet)')
  .option('--id <uuid>', 'company_id target')
  .option('--contact-id <uuid>', 'Forzar contacto especifico (default: decision maker)')
  .option(
    '--approach <type>',
    'warm_intro | nurture | direct (default: auto segun warm_path + score)',
  )
  .option('--channel <channel>', 'linkedin | email | whatsapp | instagram_dm (default: linkedin)')
  .option('--step <n>', 'Step 1-4 (solo nurture, default: 1)')
  .option('--model <alias>', 'Override del modelo: haiku | sonnet | opus (default: sonnet)')
  .action(generateMessages.run);
program
  .command('sync-hubspot')
  .description('[stub] Push meeting_booked a HubSpot')
  .action(syncHubspot.run);
program
  .command('show-pipeline')
  .description('[stub] Vista Kanban filtrable')
  .action(showPipeline.run);
program.command('show-metrics').description('[stub] KPIs por venture').action(showMetrics.run);
program
  .command('approve-message')
  .description('Listar / aprobar / editar / enviar / descartar drafts')
  .option('--id <uuid>', 'message_id target (omitir para listar drafts)')
  .option('--action <type>', 'approve | edit | send | discard')
  .option('--body <text>', 'Cuerpo nuevo (solo action=edit)')
  .option('--subject <text>', 'Subject nuevo (solo email, action=edit)')
  .option('--venture <venture>', 'Filtrar listado por venture')
  .action(approveMessage.run);

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, 'skill failed');
  process.exit(1);
});
