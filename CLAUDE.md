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
enrich-lead (canales de contacto: website scrape + Maps fallback; Apify IG scraper)
  ↓ stage=enriched · companies.phone/whatsapp/generic_email/enriched_at
score-leads (Claude JSON con zod)
  ↓ stage=qualified (≥50) o discarded
check-warm-path --auto (Apollo)
  ↓ contacts.warm_path detectado o DM teaser
generate-messages (Claude + prompt caching)
  ↓ message.status=draft
approve-message (manual CLI o dashboard /drafts)
  ↓ status=approved → enviar → status=sent + interaction
nurture-sequence (scheduler steps 2-4, 2/5/10 dias) — cron diario /api/cron/daily
  ↓ auto_send en la campaña → follow-ups de email salen solos
check-replies (IMAP) → replies + secuencia pausada → classify-reply (Haiku) → /inbox
  ↓ (lead acepta Calendly webhook o "Agendé reunión" en /inbox)
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
| `search-leads` | Apollo (1 cr/página, máx 3) | Apollo org search por venture (food/fashion) + decision-makers sin email. Retoma desde `sourcing_cursors.next_page` por hash de filtros y avanza si la página solo trae duplicados. `--dry-run` previsualiza 1 página sin insertar ni mover el cursor. wobox_fashion: filtro duro `organization_industry_tag_ids` (IDs resueltos y cacheados en `apollo.resolveIndustryTagIds`), 11–500 empleados y pre-filtro sin IA de rubro (`fashion-icp.ts`) que no inserta ni scorea lo ajeno |
| `enrich-lead` | Apify | Canales de contacto (ver `enrich-contacts`) + IG followers. `--no-scrape`, `--no-maps`, `--maps-limit` |
| `enrich-contacts` | Apify Maps (~1 cr/lugar, tope 10) | Teléfono, WhatsApp, IG y email genérico a nivel company: scrape del website (home + `/contacto` + `/contact`, gratis) y Google Maps solo si falta teléfono |
| `score-leads` | Claude | Scoring multi-dimensional con zod (wobox_fashion usa `scoring-wobox-fashion-v2`, lookalike de las 17 marcas ideales) |
| `rescore-discarded` | Claude | Re-puntúa con v2 los wobox_fashion `discarded` con último score 35–49 (`--dry-run`, `--limit`). En /pipeline: botón **Re-puntuar descartados** con filtro Wobox Fashion |
| `check-warm-path` | Apollo (1 cr en `--auto-reveal`) | `--list`/`--mark` manual o `--auto` con API |
| `generate-messages` | Claude | Draft por approach/venture/BP/canal |
| `approve-message` | — | `--action=approve|edit|send|discard` |
| `nurture-sequence` | Claude (step 2-4) | Scheduler drafts según calendario 2/5/10 (mismo canal que el paso previo; saltea `sequence_paused`) |
| `check-replies` | Claude (Haiku, si clasifica) | Lee no vistos de INBOX (IMAP, 3 días), matchea `from` con `contacts.email`, inserta `replies`, interaction `replied`, pausa la secuencia. `--no-classify`, `--dry-run` |
| `classify-reply` | Claude (Haiku) | `--id` o `--pending`: intent + acción sugerida. `not_interested` → discarded; `out_of_office` → despausa y reprograma |
| `daily-followup` | Claude + SMTP | Lo mismo que el cron: replies → nurture → auto_send (`--budget-ms`, `--skip-nurture`, `--dry-run`) |
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
| `/pipeline` | Tabla filtrable (venture/stage/min-score) + server actions para cambiar stage y descartar. Incluye botón **+ Prospect** (sourcing Apollo + scrape de canales + scoring, y después `/api/enrich` con Maps), **Enriquecer contactos**, **Generar mensajes**, y columna **Contactos** con íconos-link 📞 / WA / IG / ✉️ (o "—" si falta) más botón 🔓 por DM para revelar email vía Apollo (2 pasos: searchDecisionMakers + matchPerson, 1 crédito). |
| `/drafts` | Cards de drafts con approve/discard/edit/send inline |
| `/nurture` | Vista `nurture_today` agrupada por founder |
| `/inbox` | Replies no manejadas con intent, cuerpo y sugerencia. Botones: **Agendé reunión** (meeting_booked), **Nurture 3 meses** (discarded + reactivation_date), **Descartar**, **Marcar manejado** |
| `/campaigns` | Crear/pausar campañas + toggle **Envío automático** (`campaigns.auto_send`) |

### API routes del dashboard

| Endpoint | Qué hace |
|----------|----------|
| `POST /api/generate-messages` | Sin `ids`: planifica (companies a redactar + skips). Con `ids` (máx 3): genera esos drafts. Lo llama `prospect-bar.tsx` en loop. |
| `POST /api/prospect` | Sourcing de **+ Prospect** (Apollo con cursor de paginación en `sourcing_cursors`, máx 3 páginas/corrida; loop vía Apify). Devuelve `search` (nuevos/duplicados/página/créditos/agotado) + `toScore`. |
| `POST /api/score-leads` | Scorea `ids` (máx 3) del venture; el cliente llama en loop después de `/api/prospect`. |
| `POST /api/reveal-emails` | Auto-reveal Apollo (máx 10). `retryNoEmail` reintenta los "sin email (intento previo)" (gasta créditos). |
| `POST /api/rescore-discarded` | Sin `ids`: lista candidatas (fashion discarded, score 35–49). Con `ids` (máx 2): re-puntúa con v2. |
| `POST /api/unlock-contact` | Busca el person ID en Apollo por `orgId` + nombre, luego revela email con `matchPerson`. Gasta 1 crédito Apollo. |
| `POST /api/enrich` | `{ venture?, limit?, maps? }`. Canales de contacto para companies con `enriched_at` null: scrape website + Google Maps si falta teléfono (tope 10/corrida, `maxDuration=60`). Registra Maps en `api_usage`. |
| `GET /api/cron/daily` | Cron diario (Vercel Cron, `0 12 * * 1-5` = 9:00 ART lun-vie). Exige `Authorization: Bearer $CRON_SECRET`. Ver "Follow-up automático". |

### Canales de contacto (company-level)

- Columnas `companies.phone`, `whatsapp`, `generic_email`, `enriched_at` (migration `0011_contact_channels`). Teléfonos normalizados a E.164 `+54…` (celulares `+549…`).
- Lógica en [packages/skills/src/scrape-contact-channels.ts](packages/skills/src/scrape-contact-channels.ts): nunca pisa datos existentes. `enriched_at` se setea cuando hay teléfono o ya se intentó Maps; un pase sin Maps sin teléfono lo deja en null para el próximo pase.
- `+ Prospect` corre solo el scrape (gratis, ~5s) entre sourcing y scoring; el fallback Maps lo dispara el cliente vía `/api/enrich` para no pegarle al timeout de la server action.
- `generate-messages` resuelve el destino del canal (`resolveChannelTarget`): prefiere el dato del contacto y cae al de la company; si es un canal genérico (info@, WhatsApp del local) el prompt pide que lo deriven a la persona. `deliver.ts` manda email a `contacts.email` o, si falta, a `companies.generic_email`.

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
GMAIL_USER + GMAIL_APP_PASSWORD                                envío SMTP + lectura IMAP de replies
EMAIL_DAILY_LIMIT (default 40)                                 tope de emails/día (cuenta también los auto_send)
CRON_SECRET                                                    /api/cron/daily (setear en Vercel; Vercel Cron lo manda como Bearer)
CRON_TIME_BUDGET_MS (default 9000)                             presupuesto de tiempo del cron
```

`health-check` te dice cuál falta.

## Deployment (estado 2026-06-26)

| Pieza | Estado | Detalle |
|-------|--------|---------|
| Repo GitHub | Activo | branch `main` |
| Dashboard Next.js | Live en Vercel | https://wobox-lead-engine-web.vercel.app |
| Auth dashboard | Activo | Google OAuth + whitelist hardcoded en [apps/web/lib/auth/whitelist.ts](apps/web/lib/auth/whitelist.ts) |
| Edge Function Calendly | Active en Supabase | `/functions/v1/calendly-webhook` |
| pg_cron | 2 jobs activos | `reactivate-discarded` (lunes 09:00 UTC, desde 0012 también despausa la secuencia), `stale-contacted` (diario 10:00 UTC) |
| Vercel Cron | 1 job (Hobby permite 1 diario) | `/api/cron/daily` lun-vie 12:00 UTC — requiere `CRON_SECRET` en Vercel |
| Webhook Calendly auto | Bloqueado | Free plan no permite API webhooks (workaround manual desde /pipeline) |

### Notas de arquitectura del dashboard (Vercel Hobby)

- Las skills (`@wobox/skills`, `@wobox/prompts`, `@wobox/integrations`) están en `transpilePackages` y declaradas como `dependencies` de `apps/web` para que Next.js las bundlee correctamente.
- Los prompts `.md` van **embebidos en el bundle** (`packages/prompts/src/bundled.generated.ts`, generado por `pnpm prompts:bundle` y antes de cada `next build`). `loadPrompt` lee el `.md` del disco si existe (CLI) y si no usa el bundle (Vercel). Después de editar un prompt: `pnpm prompts:bundle` y commitear (el test `bundled.test.ts` falla si quedó desactualizado).
- "Generar mensajes" corre en el cliente en loop contra `POST /api/generate-messages` (plan + lotes de 2 companies) para no pasar el timeout; los fallos se agrupan por motivo en el resumen y quedan en `error_logs` (skill `generate-messages`, context con approach/promptName/stage).
- Las server actions que llaman APIs externas (Apollo) usan **API routes** (`/api/*`) en lugar de server actions para evitar el timeout de 10s de Vercel Hobby. Las llamadas a Apollo usan `retries: 0` en `apolloFetch` para no acumular tiempo con reintentos.

## Pendientes opcionales

1. **Cron para `daily-review`** — sigue manual desde CLI (`nurture-sequence` ya corre en `/api/cron/daily`).
2. **Upgrade Calendly Standard** — desbloquea webhooks automáticos (~10 min de wiring siguiendo los pasos de abajo).
3. **Revocar PAT de Calendly** que se expuso en chat — generar uno nuevo cuando se haga el upgrade.

## Follow-up automático (fase 3 outbound)

Migration `0012_followup.sql`: `companies.sequence_paused` / `paused_reason` / `sequence_resume_at`, `campaigns.auto_send`, tabla `replies`.

`/api/cron/daily` → `runDailyFollowup` (`packages/skills/src/daily-followup.ts`), en este orden:

1. **Replies** (`check-replies`): IMAP `imap.gmail.com` con las mismas credenciales del SMTP, no vistos de los últimos 3 días (no marca como leído; dedup por Message-ID en `replies.external_id`). Si el `from` es un contacto: inserta `replies`, crea interaction `outcome='replied'` y pausa la secuencia (`sequence_paused=true, paused_reason='replied'`). Después clasifica con `classify-reply` si queda tiempo (si no, queda `intent=null` y se clasifica en la próxima corrida con `pnpm skill classify-reply --pending`).
2. **Nurture** (`nurture-sequence`, todas las ventures): saltea pausadas y las que tienen `sequence_resume_at` futuro. Genera el siguiente paso en el mismo canal que el anterior.
3. **Auto-send**: drafts `nurture` step ≥ 2 por **email** de companies cuya campaña (activa) tiene `auto_send=true` y no están pausadas → `deliver.sendMessage` (misma lógica que "Enviar" en `/drafts` y `approve-message --action=send`). El primer contacto sigue siendo manual. Respeta `EMAIL_DAILY_LIMIT`.

**Tiempo**: Hobby corta a los 10s por default. Cada paso chequea el presupuesto (`CRON_TIME_BUDGET_MS`, default 9000) antes de cada operación cara (IMAP ~4s, generar ~7s, clasificar ~2.5s, enviar ~2s); si no alcanza, corta, lo pendiente queda para el día siguiente y la respuesta JSON trae `cutShort: true`. El route declara `maxDuration = 60`, así que se puede subir el presupuesto (p.ej. `CRON_TIME_BUDGET_MS=50000`) sin tocar código.

**Clasificación** (`classify-reply`, Haiku, prompt `packages/prompts/replies/classify-reply-v1.md`): intent `interested | question | not_now | not_interested | out_of_office | other` + acción `agendar_calendly | responder_pregunta | nurture_3_meses | descartar | reprogramar`. Efectos automáticos: `not_interested` → stage `discarded`; `out_of_office` → despausa, `sequence_resume_at = hoy + N días` y marca la reply como manejada. El resto se decide en `/inbox`.

Probar a mano:

```bash
pnpm skill check-replies --dry-run
pnpm skill daily-followup --dry-run --budget-ms=60000
curl -H "Authorization: Bearer $CRON_SECRET" https://wobox-lead-engine-web.vercel.app/api/cron/daily
```

Requisitos: IMAP habilitado en Gmail (Settings → Forwarding and POP/IMAP) y `CRON_SECRET` en las env vars de Vercel.

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
