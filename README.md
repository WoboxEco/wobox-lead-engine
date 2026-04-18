# Wobox Lead Engine

Motor unificado de generacion y gestion de leads outbound para **Wobox Food**, **Wobox Fashion** y **Loop**.

End-to-end: Prospeccion -> Calentamiento -> Contacto -> Reunion -> Metricas -> Flywheel.

## Stack

- **TypeScript** + **pnpm** workspaces (monorepo)
- **Supabase** (PostgreSQL + Auth + Edge Functions + pg_cron)
- **Claude API** (scoring + generacion de mensajes)
- **Apollo.io** (leads estructurados: cadenas y franquicias)
- **Apify** (web search + Instagram scraping para negocios locales de Loop)
- **HubSpot** (CRM, pipeline de ventas)
- **Next.js 15** (dashboard, Capa 3)
- **Biome** (lint + format)

## Arquitectura: 3 capas

```
Capa 1: Skills         packages/skills     CLI desde terminal
Capa 2: Agentes        packages/agents     Orquestacion de skills
Capa 3: App web        apps/web            Dashboard para los 3 founders
```

Ver `docs/architecture.md` para el mapa completo y el data flow.

## Setup inicial

```bash
# 1. Instalar deps
pnpm install

# 2. Configurar credenciales
cp .env.example .env
# Editar .env con: SUPABASE_*, ANTHROPIC_API_KEY (minimo para arrancar)

# 3. Crear tablas en Supabase
pnpm skill setup-database

# 4. Generar tipos de la DB
pnpm db:types

# 5. Probar scoring end-to-end
# (insertar 1 company de prueba desde el dashboard de Supabase, luego:)
pnpm skill score-leads --venture=loop --id=<uuid>
```

## Comandos

```bash
pnpm skill <nombre> [flags]       # correr una skill
pnpm agent <nombre> [flags]       # correr un agente
pnpm dev                          # levantar la webapp (Capa 3)
pnpm typecheck                    # chequear tipos en todos los workspaces
pnpm lint                         # Biome
pnpm lint:fix                     # Biome autofix
pnpm db:types                     # regenerar packages/core/src/database.types.ts
```

## Skills disponibles

| Skill              | Estado        | Descripcion                                                    |
|--------------------|---------------|----------------------------------------------------------------|
| setup-database     | implementada  | Corre migrations contra Supabase                               |
| score-leads        | implementada  | Scorea leads con el modelo correcto segun venture              |
| search-leads       | stub          | Busqueda Apollo (Wobox + cadenas Loop)                         |
| search-leads-web   | stub          | Busqueda web + Apify (Loop negocios locales)                   |
| import-csv         | stub          | Import bulk desde CSV                                          |
| enrich-lead        | stub          | Instagram + web enrichment                                     |
| check-warm-path    | stub          | Detecta conexiones 1er/2do grado via Apollo                    |
| generate-messages  | stub          | Genera mensajes via Claude segun venture + approach + channel  |
| sync-hubspot       | stub          | Push meeting_booked a HubSpot, pull cierres                    |
| show-pipeline      | stub          | Vista Kanban filtrable                                         |
| show-metrics       | stub          | KPIs por venture + buyer persona                               |
| approve-message    | stub          | Aprobar/editar/descartar drafts                                |

## Ventures y modelos de scoring

- **Wobox Food + Fashion**: `prompts/scoring/scoring-wobox-v1.md` (vertical, escala, sobrestock, franquicia, region).
- **Loop**: `prompts/scoring/scoring-loop-v1.md` (recurrencia, sub-sector, digital, escala, region). Asigna buyer persona BP1-BP6.

## Pipelines

- **Prospeccion** (en la app): `new -> enriched -> qualified -> nurturing -> contacted -> meeting_booked -> discarded`
- **Ventas** (en HubSpot): `sin contacto -> contacto -> presentacion -> negociacion -> onboarding -> cierre ganado/perdido`
- Puente: `meeting_booked` crea deal en HubSpot; cierres vuelven a Supabase para el flywheel.

## Docs

- `docs/wobox-lead-engine-FINAL.md` — especificacion tecnica completa
- `docs/wobox-lead-engine-como-funciona.md` — overview funcional
- `docs/architecture.md` — mapa del codigo y data flow
