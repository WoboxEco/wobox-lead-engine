# Arquitectura — Wobox Lead Engine

## Mapa del monorepo

```
wobox-lead-engine/
├── apps/web/                   Capa 3: Dashboard Next.js (scaffold vacio)
├── packages/
│   ├── core/                   Env, DB client, logger, errores, tipos de dominio
│   ├── prompts/                Prompts versionados (markdown) + loader con {{VAR}}
│   ├── integrations/           Wrappers de Claude, Apollo, Apify, HubSpot, Calendly
│   ├── skills/                 Capa 1: CLI unificado (pnpm skill <nombre>)
│   └── agents/                 Capa 2: orquestadores de skills
├── supabase/
│   ├── migrations/             Schema + RLS + pg_cron
│   └── functions/              Edge Functions (Calendly webhook)
└── docs/                       Specs + este archivo
```

## Data flow: "Prospecta Loop, gastronomico, CABA Palermo"

```
1. search-leads-web
   -> Apify Google Maps crawler por barrios
   -> Apify Instagram scraper para enrichment basico
   -> dedup por linkedin_url > website > instagram_handle > name+region
   -> insert companies con source='web_search'

2. enrich-lead
   -> Para companies sin instagram: extraer handle del website
   -> Follower count + posts recientes via Apify
   -> stage new -> enriched

3. score-leads
   -> Detecta venture=loop -> carga scoring-loop-v1.md
   -> Claude devuelve JSON validado con zod
   -> Insert en scores con dimensions JSONB + buyer_persona
   -> stage enriched -> qualified (si score >= 50)

4. check-warm-path
   -> Apollo connections para decision makers
   -> contacts.warm_path + warm_connector

5. generate-messages
   -> Para qualified sin warm path: approach=direct
   -> Con warm path: approach=warm_intro
   -> Con score 50-79: approach=nurture (secuencia de 4 steps)
   -> Prompt selection segun venture + approach + vertical/buyer_persona
   -> Insert en messages status='draft', original_body=body

6. approve-message (humano)
   -> Founder revisa en dashboard, edita si hace falta (body diverge de original_body)
   -> status='approved' -> enviar manual -> marcar 'sent' + registrar interaction

7. (dia 2-7) nurture-sequence
   -> pg_cron daily arma vista nurture_today
   -> Dashboard muestra touchpoints del dia por founder
   -> generate-messages(step=2,3,4) segun progreso

8. (lead acepta) Calendly -> webhook
   -> Edge Function matchea email contacto -> stage=meeting_booked
   -> Insert interaction type='meeting'
   -> sync-hubspot crea deal en HubSpot stage 'contacto'

9. HubSpot close (ganado/perdido)
   -> sync-hubspot pull -> actualiza companies.stage + flywheel
```

## Decisiones clave

| Tema | Decision | Por que |
|------|----------|---------|
| Lenguaje | TypeScript strict | Contratos DB + Claude + Apollo + Apify deben ser type-safe end-to-end |
| Monorepo | pnpm workspaces | Lean, sin overhead de turbo para 4 packages |
| Scores dimensions | JSONB | Dimensiones distintas por modelo (wobox vs loop) sin migraciones |
| Auth | Google OAuth via Supabase | Cero passwords a gestionar |
| Cron | pg_cron en Supabase | Sin infra extra; notificaciones in-app via vista |
| Calendly | Edge Function + HMAC | Automatico, sin polling |
| Web search | Apify (Maps + IG) | Mantenido, resistente a anti-bot |
| Apollo | Free tier + wrapper agnostico | Validar antes de gastar |
| Prompts | Archivos .md versionados | prompt_version trackea reejecucion; v1/v2/v3 conviven |
| Lint | Biome | Un solo tool, 10x mas rapido que ESLint+Prettier |

## Flywheel: como aprende el sistema

- Cada mensaje guarda `original_body` (IA) vs `body` (final humano). Query: que partes se editan mas -> ajustar prompt.
- Cada interaction tiene `outcome`. Query: conversion por approach x venture x buyer_persona -> ajustar scoring weights y message prompts.
- `api_usage` trackea tokens y creditos por venture -> cost per lead por producto.

## Runbook: primer setup

```bash
# 1. Crear proyecto en Supabase (https://supabase.com/dashboard)
#    - Activar extension pg_cron desde Database > Extensions
#    - Copiar URL + anon key + service_role key al .env

# 2. Crear funcion exec_sql una vez (SQL Editor):
#    CREATE OR REPLACE FUNCTION exec_sql(sql text) RETURNS void
#    LANGUAGE plpgsql AS $$ BEGIN EXECUTE sql; END; $$;

# 3. Correr migrations
pnpm skill setup-database

# 4. Generar tipos
pnpm db:types

# 5. Configurar Google OAuth en Supabase Auth > Providers

# 6. Configurar Calendly webhook apuntando a:
#    https://<project>.supabase.co/functions/v1/calendly-webhook

# 7. Crear custom property 'venture' en HubSpot (single-select):
#    Valores: wobox_food, wobox_fashion, loop

# 8. Smoke test
#    Insertar 1 company desde el SQL editor (ver supabase/seed.sql)
#    pnpm skill score-leads --venture=loop --all --limit=1
```

## Como agregar una skill nueva

1. Crear `packages/skills/src/<nombre>.ts` con `export async function run(opts) {...}`.
2. Registrar en `packages/skills/src/cli.ts` con `program.command(...)`.
3. Si necesita una nueva integracion externa: agregar wrapper en `packages/integrations/src/`.
4. Si necesita un prompt nuevo: crear `packages/prompts/<categoria>/<nombre>-v1.md` con placeholders `{{VAR}}`.
5. Si modifica el schema: nueva migration en `supabase/migrations/NNNN_<nombre>.sql` + regenerar tipos.
