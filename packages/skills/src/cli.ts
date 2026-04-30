#!/usr/bin/env tsx
import { logger } from '@wobox/core';
import { Command } from 'commander';

import * as approveMessage from './approve-message.js';
import * as checkWarmPath from './check-warm-path.js';
import * as enrichLead from './enrich-lead.js';
import * as generateMessages from './generate-messages.js';
import * as healthCheck from './health-check.js';
import * as importCsv from './import-csv.js';
import * as importFromHubspot from './import-from-hubspot.js';
import * as nurtureSequence from './nurture-sequence.js';
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
  .command('health-check')
  .description('Valida env vars + auth contra Supabase/Apollo/Apify/HubSpot')
  .option('--skip-net', 'Solo validar env schema, sin llamadas de red')
  .action(healthCheck.run);

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
  .description('Apollo organizations search para Wobox food/fashion + Loop cadenas')
  .option('--venture <venture>', 'wobox_food | wobox_fashion | loop (REQUIRED)')
  .option('--limit <n>', 'Max orgs por corrida (default: 25, Apollo per_page max)')
  .option('--industries <csv>', 'Override industries (csv). Default segun venture.')
  .option(
    '--employee-ranges <csv>',
    'Override rangos de empleados, separados por ; (ej: "11,50;51,200")',
  )
  .option('--exclude-industries <csv>', 'Override exclusiones (csv)')
  .option('--region <name>', 'Override location (default: Argentina)')
  .option('--keywords <text>', 'Free text adicional')
  .option('--campaign <name>', 'Asociar leads a una campana (se crea si no existe)')
  .option('--model <alias>', 'Override modelo (no usado actualmente, mantenido por parity)')
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
program
  .command('import-from-hubspot')
  .description('Bulk import: trae companies + contacts desde HubSpot a Supabase')
  .option(
    '--venture <venture>',
    'Venture default si la company no tiene "venture" property en HubSpot',
  )
  .option('--stage <stage>', 'Stage para companies importadas (default: qualified)')
  .option('--limit <n>', 'Procesar solo N companies en vez de iterar todas')
  .option('--dry-run', 'No insertar nada, solo loguear')
  .action(importFromHubspot.run);

program
  .command('import-csv')
  .description('Bulk import de companies (+contacts opcional) desde CSV')
  .option('--file <path>', 'Path al CSV (requerido)')
  .option('--venture <venture>', 'Venture por defecto si el CSV no tiene columna')
  .option('--dry-run', 'Parsea y valida sin insertar')
  .option('--update', 'Si la company ya existe, actualiza campos (default: skip)')
  .action(importCsv.run);
program
  .command('enrich-lead')
  .description('Instagram enrichment via Apify: followers + posts, new -> enriched')
  .option('--id <uuid>', 'company_id target (omitir para batch)')
  .option('--all', 'Procesar todas las companies con stage=new sin social_followers')
  .option('--limit <n>', 'Max companies por corrida (default: 30)', (v) => Number.parseInt(v, 10))
  .option('--venture <venture>', 'Filtrar por venture')
  .option('--force', 'Rescan companies ya enriquecidas')
  .option('--no-scrape', 'No intentar fetch del website para extraer IG link')
  .action(enrichLead.run);
program
  .command('check-warm-path')
  .description(
    'Lista qualified leads sin warm-path, detecta con Apollo (--auto), o marca manualmente',
  )
  .option('--auto', 'Detecta warm paths automaticamente via Apollo API')
  .option('--auto-limit <n>', 'Max companies a procesar en --auto (default: 10)', (v) =>
    Number.parseInt(v, 10),
  )
  .option('--auto-min-score <n>', 'Score minimo para gastar credito de reveal (default: 70)', (v) =>
    Number.parseInt(v, 10),
  )
  .option(
    '--auto-reveal',
    'Gastar creditos Apollo para revelar email/linkedin de DMs (default: false)',
  )
  .option('--id <uuid>', 'company_id target (omitir para listar)')
  .option('--path <type>', 'direct | 2nd_degree | none')
  .option('--connector <name>', 'Quien hace la intro (ej: "Yo", "Juan Perez")')
  .option('--decision-maker <name>', 'Nombre del decisor en la empresa')
  .option('--email <email>', 'Email del decisor (opcional pero recomendado)')
  .option('--role <role>', 'Cargo (ej: "CEO", "Dueno", "Gerente comercial")')
  .option('--venture <venture>', 'Filtrar listado (default: loop)')
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
  .command('nurture-sequence')
  .description('Genera drafts step 2-4 para companies nurturing segun calendario (2/5/10 dias)')
  .option('--venture <venture>', 'Filtrar por venture')
  .option('--limit <n>', 'Max companies por corrida (default: 50)', (v) => Number.parseInt(v, 10))
  .option('--dry-run', 'Solo reportar que haria, sin generar')
  .option('--model <alias>', 'Override del modelo: haiku | sonnet | opus (default: sonnet)')
  .action(nurtureSequence.run);
program
  .command('sync-hubspot')
  .description('Push meeting_booked a HubSpot + pull closed deals para flywheel')
  .option('--direction <dir>', 'push | pull | both (default: both)')
  .option('--since-days <n>', 'Ventana para pull (default: 7)')
  .action(syncHubspot.run);
program
  .command('show-pipeline')
  .description('Vista tipo Kanban filtrable por venture/stage/BP/campana/score')
  .option('--venture <venture>', 'wobox_food | wobox_fashion | loop')
  .option(
    '--stage <stage>',
    'new | enriched | qualified | nurturing | contacted | meeting_booked | discarded',
  )
  .option('--bp <BP>', 'BP1..BP6 (solo Loop)')
  .option('--campaign <uuid>', 'Filtrar por campaign_id')
  .option('--founder <uuid>', 'Filtrar por assigned_to')
  .option('--min-score <n>', 'Solo leads con score >= N')
  .option('--limit <n>', 'Max filas (default: 200)')
  .action(showPipeline.run);
program
  .command('show-metrics')
  .description('KPIs + flywheel: funnel, BP, mensajes, edit rate, reply rate, costos')
  .option('--venture <venture>', 'Filtrar por venture')
  .option('--period <days>', 'Ventana de dias hacia atras (default: 30)')
  .action(showMetrics.run);
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
