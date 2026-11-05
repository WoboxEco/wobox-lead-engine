# CLAUDE.md — Wobox Lead Engine

Motor de prospección outbound para 3 ventures: `wobox_food`, `wobox_fashion`, `loop`.

**Stack:** TypeScript strict · pnpm workspaces · Next.js 15 / React 19 · Supabase (pg_cron + Edge Functions) · Claude API (prompt caching) · Apollo + Apify + HubSpot + Calendly.

Para el diseño detallado y data flow ver [docs/architecture.md](docs/architecture.md). Este archivo es el runbook operativo.

## Layout

```
apps/web/             Dashboard Next.js (pipeline, drafts, nurture, campaigns)
packages/core/        Env, DB client, logger, errores, tipos de dominio
packages/prompts/     Prompts versionados (markdown) + loader con {{VAR}}
packages/integrations Wrappers tipados: Claude, Apollo, Apify, HubSpot, Calendly
packages/skills/      CLI unificado (pnpm skill <nombre>)
packages/agents/      Orquestadores que encadenan skills (pnpm agent <nombre>)
supabase/
  migrations/         Schema + RLS + pg_cron
  functions/          Edge Functions (Calendly webhook)
```

## Primera vez

```bash
cp .env.example .env               # completar claves
pnpm install
pnpm skill setup-database          # aplica migrations a Supabase
pnpm db:types                      # regenera database.types.ts
pnpm skill health-check            # valida env + auth con todas las APIs
```

## Pipeline end-to-end

```
search-leads-web (Apify Maps + IG)
  ↓ stage=new
enrich-lead (Apify IG scraper + website HTML scrape)
  ↓ stage=enriched
score-leads (Claude JSON con zod)
  ↓ stage=qualified (≥50) o discarded
check-warm-path --auto (Apollo)
  ↓ contacts.warm_path detectado o DM teaser
generate-messages (Claude + prompt caching)
  ↓ message.status=draft
approve-message (manual CLI o dashboard /drafts)
  ↓ status=approved → enviar → status=sent + interaction
nurture-sequence (scheduler steps 2-4, 2/5/10 dias)
  ↓ (lead acepta Calendly webhook)
sync-hubspot (push meeting_booked, pull closed deals para flywheel)
```

Un solo comando que ejecuta search → enrich → score → warm:

```bash
pnpm agent full-prospecting --venture=loop --subsector=cafeteria \
     --neighborhood="Palermo Soho" --limit=30
```

## Comandos frecuentes

```bash
# CLI
pnpm skill <nombre> [flags]        # skill individual
pnpm agent <nombre> [flags]        # orquestador

# Dashboard
pnpm dev                           # Next.js en localhost:3000

# Quality
pnpm typecheck                     # todos los packages
pnpm lint                          # Biome
```

## Skills disponibles

| Skill | Gasta | Descripción |
|-------|-------|-------------|
| `setup-database` | — | Aplica migrations (idempotente) |
| `health-check` | — | Valida env + auth con APIs |
| `import-csv` | — | Bulk import offline desde CSV |
| `search-leads-web` | Apify + Claude | Apify Maps + IG por barrio |
| `search-leads` | Apollo (1 cr/búsqueda) | Apollo org search por venture (food/fashion/loop) + decision-makers sin email. `--dry-run` previsualiza sin insertar |
| `enrich-lead` | Apify | IG followers + website scrape para IG handle |
| `score-leads` | Claude | Scoring multi-dimensional con zod |
| `check-warm-path` | Apollo (1 cr en `--auto-reveal`) | `--list`/`--mark` manual o `--auto` con API |
| `generate-messages` | Claude | Draft por approach/venture/BP/canal |
| `approve-message` | — | `--action=approve|edit|send|discard` |
| `nurture-sequence` | Claude (step 2-4) | Scheduler drafts según calendario 2/5/10 |
| `sync-hubspot` | — | Push meeting_booked + pull closed deals |
| `show-pipeline` / `show-metrics` | — | Lectura (Kanban + KPIs) |

## Agents disponibles

| Agent | Descripción |
|-------|-------------|
| `full-prospecting` | search → enrich → score → check-warm-path en secuencia |
| `daily-review` | Resumen cross-venture (nuevos, drafts, enviados, meetings) |
| `nurture-sequence` | [stub] wrapper para cronear |
| `campaign-report` | [stub] Analytics por campaña |

## Dashboard

| Ruta | Qué muestra |
|------|-------------|
| `/` | Counts por stage + por venture |
| `/pipeline` | Tabla filtrable (venture/stage/min-score) + server actions para cambiar stage y descartar. Incluye botón **+ Prospect** (sourcing Apollo + scoring), **Generar mensajes**, y columna **Contactos** con botón 🔓 por DM para revelar email vía Apollo (2 pasos: searchDecisionMakers + matchPerson, 1 crédito). |
| `/drafts` | Cards de drafts con approve/discard/edit/send inline |
| `/nurture` | Vista `nurture_today` agrupada por founder |

### API routes del dashboard

| Endpoint | Qué hace |
|----------|----------|
| `POST /api/generate-messages` | Sin `ids`: planifica (companies a redactar + skips). Con `ids` (máx 3): genera esos drafts. Lo llama `prospect-bar.tsx` en loop. |
| `POST /api/reveal-emails` | Auto-reveal Apollo (máx 10). `retryNoEmail` reintenta los "sin email (intento previo)" (gasta créditos). |
| `POST /api/unlock-contact` | Busca el person ID en Apollo por `orgId` + nombre, luego revela email con `matchPerson`. Gasta 1 crédito Apollo. |

## Convenciones

- **Idioma**: Todo en español rioplatense (prompts, messages, docs internos).
- **Formato números en respuestas de Claude**: sin decimales (skill global).
- **Lint**: Biome (no ESLint). `pnpm lint:fix` antes de commitear si hay errores.
- **Tipos Supabase**: generar con `pnpm db:types` después de cada migration nueva.
- **Prompts**: `packages/prompts/<categoria>/<nombre>-v<N>.md` con placeholders `{{VAR}}`. `prompt_version` se guarda en `messages` para poder reescribir.
- **Tracking de costo**: `api_usage` registra tokens (Claude) y créditos (Apollo) por operación y venture.
- **`original_body` vs `body`** en messages: `original_body` es la IA, `body` es final humano. Edit rate ↘ señal para ajustar prompts.
- **Dedup companies**: `linkedin_url` > `website_normalized` > `instagram_handle+venture` > `name ilike+venture`.

## Variables de entorno importantes

```
SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY   requerido
ANTHROPIC_API_KEY + CLAUDE_MODEL                               score/generate
APOLLO_API_KEY (free tier)                                     check-warm-path --auto
APIFY_API_TOKEN                                                search-leads-web, enrich-lead
HUBSPOT_PRIVATE_APP_TOKEN                                      sync-hubspot
CALENDLY_SIGNING_KEY                                           edge function
```

`health-check` te dice cuál falta.

## Deployment (estado 2026-06-26)

| Pieza | Estado | Detalle |
|-------|--------|---------|
| Repo GitHub | Activo | branch `main` |
| Dashboard Next.js | Live en Vercel | https://wobox-lead-engine-web.vercel.app |
| Auth dashboard | Activo | Google OAuth + whitelist hardcoded en [apps/web/lib/auth/whitelist.ts](apps/web/lib/auth/whitelist.ts) |
| Edge Function Calendly | Active en Supabase | `/functions/v1/calendly-webhook` |
| pg_cron | 2 jobs activos | `reactivate-discarded` (lunes 09:00 UTC), `stale-contacted` (diario 10:00 UTC) |
| Webhook Calendly auto | Bloqueado | Free plan no permite API webhooks (workaround manual desde /pipeline) |

### Notas de arquitectura del dashboard (Vercel Hobby)

- Las skills (`@wobox/skills`, `@wobox/prompts`, `@wobox/integrations`) están en `transpilePackages` y declaradas como `dependencies` de `apps/web` para que Next.js las bundlee correctamente.
- Los prompts `.md` van **embebidos en el bundle** (`packages/prompts/src/bundled.generated.ts`, generado por `pnpm prompts:bundle` y antes de cada `next build`). `loadPrompt` lee el `.md` del disco si existe (CLI) y si no usa el bundle (Vercel). Después de editar un prompt: `pnpm prompts:bundle` y commitear (el test `bundled.test.ts` falla si quedó desactualizado).
- "Generar mensajes" corre en el cliente en loop contra `POST /api/generate-messages` (plan + lotes de 2 companies) para no pasar el timeout; los fallos se agrupan por motivo en el resumen y quedan en `error_logs` (skill `generate-messages`, context con approach/promptName/stage).
- Las server actions que llaman APIs externas (Apollo) usan **API routes** (`/api/*`) en lugar de server actions para evitar el timeout de 10s de Vercel Hobby. Las llamadas a Apollo usan `retries: 0` en `apolloFetch` para no acumular tiempo con reintentos.

## Pendientes opcionales

1. **Cron externo para `nurture-sequence` y `daily-review`** — hoy se corren manuales desde CLI.
   - GitHub Actions con cron diario que ejecute `pnpm skill nurture-sequence` (gratis, fácil)
   - Vercel Cron Functions (requiere exponer endpoint HTTP en `apps/web`)
2. **Upgrade Calendly Standard** — desbloquea webhooks automáticos (~10 min de wiring siguiendo los pasos de abajo).
3. **Revocar PAT de Calendly** que se expuso en chat — generar uno nuevo cuando se haga el upgrade.

## Edge Function — Calendly webhook

Deployada en `supabase/functions/calendly-webhook/index.ts`. Verifica HMAC SHA-256, matchea contacto por email, transiciona `stage → meeting_booked` y crea `interaction type='meeting'`. Endpoint en producción:

```
https://bzlcewjkxifuexuhafwx.supabase.co/functions/v1/calendly-webhook
```

**Importante — Calendly Free no soporta webhooks** (verificado 2026-04: la API responde 403 "Please upgrade your Calendly account to Standard" al crear `webhook_subscriptions`). Mientras estemos en Free:

- El founder marca manualmente `stage = meeting_booked` desde [/pipeline](apps/web/app/pipeline/page.tsx) cuando un lead acepta una reunión
- Eso dispara la transición igual; sync-hubspot push lo lleva a HubSpot en la próxima corrida

Para activarlo automático cuando upgrades a Standard:
1. Crear PAT en https://calendly.com/integrations/api_webhooks con scopes `webhooks:read+write`, `users:read`, `scheduled_events:read`
2. `POST https://api.calendly.com/webhook_subscriptions` con `url`, `events: ["invitee.created"]`, `organization`, `user`, `scope: "user"`
3. Setear `CALENDLY_SIGNING_KEY` (de la respuesta) como secret de la Edge Function en Supabase.

## Cómo agregar

- **Skill nueva**: archivo `packages/skills/src/<n>.ts` con `export async function run(opts)`. Registrar en `cli.ts` y re-exportar en `index.ts` si la vas a llamar desde agents.
- **Prompt nuevo**: `packages/prompts/<cat>/<n>-v1.md` con placeholders `{{VAR}}`. Usar `loadPrompt()` con `cachedPrefix` para cache ephemeral.
- **Migration**: `supabase/migrations/NNNN_<nombre>.sql`. Después `pnpm db:types` + `pnpm skill setup-database`.
- **Integración nueva**: wrapper en `packages/integrations/src/<n>.ts` + export en `index.ts`.
