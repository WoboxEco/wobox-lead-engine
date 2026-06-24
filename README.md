# Wobox Lead Engine

Motor de prospección outbound para **Wobox Food**, **Wobox Fashion** y **Loop**.

End-to-end: Sourcing → Enrich → Scoring → Warm-path → Mensajes → Aprobación → Nurture → CRM.

> **Nota de uso:** hoy corre **localmente** (`pnpm dev` + CLI en tu máquina). No está pensado como servicio hosteado.

## Stack

- **TypeScript** + **pnpm** workspaces (monorepo)
- **Supabase** (PostgreSQL + Auth + Edge Functions + pg_cron)
- **Claude API** (scoring + generación de mensajes, con prompt caching)
- **Apollo.io** (sourcing de empresas + decision-makers)
- **Apify** (Google Maps + Instagram scraping)
- **HubSpot** (CRM) · **Calendly** (booking)
- **Next.js 15 / React 19** (dashboard)
- **Biome** (lint + format)

## Arquitectura: 3 capas

```
Capa 1: Skills      packages/skills    CLI individual (pnpm skill <n>)
Capa 2: Agentes     packages/agents    Orquestan varias skills (pnpm agent <n>)
Capa 3: Dashboard   apps/web           Next.js (pipeline, drafts, nurture)
```

Packages de soporte: `core` (env, DB, tipos), `prompts` (prompts versionados), `integrations` (wrappers de cada API).

Ver `docs/architecture.md` para el data flow completo. `CLAUDE.md` es el runbook operativo detallado.

## Requisitos

- **Node 22+** y **pnpm 9+**
- Un proyecto de **Supabase** (gratis)
- API keys: Anthropic (obligatoria), Apollo / Apify / HubSpot (según qué uses)

## Setup inicial

```bash
# 1. Instalar deps
pnpm install

# 2. Configurar credenciales
cp .env.example .env
#    Completar al menos SUPABASE_* + ANTHROPIC_API_KEY.
#    El resto (Apollo/Apify/HubSpot) según las fuentes que vayas a usar.

# 3. Crear el schema en Supabase (idempotente)
pnpm skill setup-database

# 4. Generar tipos de la DB
pnpm db:types

# 5. Validar que todas las APIs autentican
pnpm skill health-check
```

`health-check` te dice exactamente qué credencial falta o falla.

## Correr la app (local)

```bash
pnpm dev          # dashboard en http://localhost:3000
```

El dashboard tiene login con Google + whitelist de emails en
[apps/web/lib/auth/whitelist.ts](apps/web/lib/auth/whitelist.ts). Agregá tu email ahí para entrar.
El server tiene que estar corriendo para que el dashboard funcione.

## Comandos

```bash
pnpm skill <nombre> [flags]   # correr una skill
pnpm agent <nombre> [flags]   # correr un agente (orquestador)
pnpm dev                      # dashboard
pnpm typecheck                # tipos en todos los workspaces
pnpm lint  /  pnpm lint:fix   # Biome
pnpm db:types                 # regenerar packages/core/src/database.types.ts
```

## Pipeline end-to-end

```
search-leads (Apollo)  ─┐
sourcing-cas (CAS)     ─┼─► enrich-lead ─► score-leads ─► check-warm-path ─► generate-messages
search-leads-web       ─┤   (web + IG)     (≥50 →         (revela email      (drafts)
import-csv             ─┘                   qualified)     1cr c/u)              │
                                                                                 ▼
            sync-hubspot ◄─ Calendly webhook ◄─ nurture-sequence ◄─ approve-message
```

Un solo comando que encadena search → enrich → score → warm:

```bash
pnpm agent full-prospecting --venture=loop --subsector=cafeteria --neighborhood="Palermo Soho" --limit=30
```

## Skills

| Skill | Gasta | Descripción |
|-------|-------|-------------|
| `setup-database` | — | Aplica migrations (idempotente) |
| `health-check` | — | Valida env + auth con todas las APIs |
| `import-csv` | — | Bulk import offline desde CSV |
| `search-leads` | Apollo (1 cr) | Org search por venture + decision-makers (`--dry-run` previsualiza) |
| `search-leads-web` | Apify + Claude | Google Maps + IG por barrio |
| `sourcing-cas` | — (scrape) | Directorio Cámara Arg. de Supermercados → wobox_food |
| `enrich-lead` | Apify | Followers IG + scrape de website |
| `score-leads` | Claude | Scoring multi-dimensional; ≥50 → qualified, <50 → discarded |
| `check-warm-path` | Apollo (1 cr en reveal) | Detecta warm-path / revela email |
| `generate-messages` | Claude | Drafts por approach/venture/canal. `--id` (single) o `--all` (batch) |
| `approve-message` | — | approve / edit / send / discard |
| `nurture-sequence` | Claude | Follow-ups (días 2/5/10) |
| `sync-hubspot` | — | Push meeting_booked + pull cierres |
| `show-pipeline` / `show-metrics` | — | Lectura (Kanban + KPIs) |

## Dashboard

| Ruta | Qué muestra |
|------|-------------|
| `/` | Counts por stage + venture |
| `/pipeline` | Tabla filtrable + **botones `+Prospect` y `Generar mensajes`** (disparan el pipeline sin terminal) + cambiar stage / descartar |
| `/drafts` | Drafts con approve / edit / send inline |
| `/nurture` | Vista `nurture_today` por founder |
| `/daily-review` | Resumen cross-venture |

## Ventures

- **Wobox Food** → supermercados, alimentos, productores. Fuentes: CAS, Apollo, Apify Maps.
- **Wobox Fashion** → marcas de indumentaria / calzado. Fuente: Apollo (o CSV de Sales Navigator).
- **Loop** → cadenas de gastronomía / wellness / retail. Fuente: Apify Maps por barrio.

El venture define **qué** se busca, **cómo** se puntúa y **cómo** se redactan los mensajes.

## Variables de entorno

Ver [.env.example](.env.example). Mínimo para arrancar: `SUPABASE_*` + `ANTHROPIC_API_KEY`.
El resto habilita fuentes específicas (Apollo, Apify, HubSpot, Calendly). `health-check` valida todo.

## Docs

- `CLAUDE.md` — runbook operativo (comandos, convenciones, estado)
- `docs/architecture.md` — mapa del código y data flow
- `docs/handoff.md` — status del proyecto + roadmap
- `docs/wobox-lead-engine-FINAL.md` — especificación técnica completa
- `docs/wobox-lead-engine-como-funciona.md` — overview funcional
