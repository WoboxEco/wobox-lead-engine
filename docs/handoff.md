# Handoff — Wobox Lead Engine

Status del proyecto al 2026-04-29 + roadmap para onboardear a alguien nuevo + walkthrough del dashboard para demos.

> Este documento es el **resumen ejecutivo**. Para detalle técnico ver [architecture.md](architecture.md), para operación día a día ver el [CLAUDE.md](../CLAUDE.md) en la raíz.

---

## 1. Status técnico

### Stack
- TypeScript strict · pnpm workspaces · Node 22
- Next.js 15 + React 19 (App Router, Server Components, Server Actions)
- Supabase (Postgres + Auth + Edge Functions + pg_cron)
- Claude API (prompt caching para abaratar score/generate)
- Apify (Maps + Instagram scrapers), Apollo.io, HubSpot, Calendly
- Hosted en Vercel + GitHub Actions

### Schema (8 tablas en Postgres)

| Tabla | Rol |
|-------|-----|
| `companies` | Entidad central. Stages: `new → enriched → qualified → nurturing → contacted → meeting_booked` (o `discarded`). Multi-venture. |
| `campaigns` | Agrupador de leads por iniciativa. |
| `contacts` | Decision makers (nombre, cargo, IG, LinkedIn, warm_path). |
| `scores` | Scoring multi-dimensional de Claude (JSON con zod). |
| `interactions` | Log inmutable de touchpoints (likes, DMs, calls, meetings). |
| `messages` | Drafts + enviados. `original_body` (Claude) vs `body` (humano editado). |
| `error_logs` | Errores de skills/agents. |
| `api_usage` | Tracking de costo: tokens Claude + créditos Apollo por op + venture. |

### Capa 1 — Skills (13 comandos en CLI)

| Skill | Gasta | Qué hace |
|-------|-------|----------|
| `setup-database` | — | Aplica migrations |
| `health-check` | — | Valida envs + auth con todas las APIs |
| `import-csv` | — | Bulk import offline |
| `search-leads-web` | Apify + Claude | Apify Maps + IG por barrio |
| `search-leads` | — | Stub (Apollo) |
| `enrich-lead` | Apify | IG followers + scrape website |
| `score-leads` | Claude | Scoring con zod |
| `check-warm-path` | Apollo | Manual o `--auto` |
| `generate-messages` | Claude | Drafts por approach/venture/BP |
| `approve-message` | — | Aprobar / editar / enviar / descartar |
| `nurture-sequence` | Claude | Drafts steps 2-4 según calendario 2/5/10 |
| `sync-hubspot` | — | Push meeting_booked + pull closed deals |
| `show-pipeline` / `show-metrics` | — | Lectura |

### Capa 2 — Agents (4 orquestadores)

| Agent | Estado |
|-------|--------|
| `full-prospecting` | Producción: search → enrich → score → warm |
| `daily-review` | Producción: resumen cross-venture |
| `nurture-sequence` | Stub (wrapper para cronear) |
| `campaign-report` | Stub (analytics por campaña) |

### Capa 3 — Dashboard (8 rutas)

| Ruta | Para qué se usa |
|------|----|
| `/` | Counts globales por stage y venture |
| `/pipeline` | Tabla filtrable + cambiar stage / descartar inline |
| `/drafts` | Cards con aprobar / editar / enviar / descartar |
| `/nurture` | Vista `nurture_today` agrupada por founder |
| `/campaigns` | Crear + ver estado de campañas |
| `/daily-review` | KPIs de últimas 24h/7d/30d con breakdown por venture |
| `/login` | Google OAuth |
| `/auth/forbidden` | Bloqueo si email no whitelisted |

### Auth
- Google OAuth via Supabase
- Whitelist hardcoded en [apps/web/lib/auth/whitelist.ts](../apps/web/lib/auth/whitelist.ts): `sebastian@`, `juan@`, `vir@` `wobox.ar`
- Middleware Next gate-keepea todas las rutas excepto `/login` y `/auth/*`

### Automatización

| Job | Donde corre | Cuando |
|-----|-------------|--------|
| `reactivate-discarded` | pg_cron en Supabase | Lunes 09:00 UTC |
| `stale-contacted` | pg_cron en Supabase | Diario 10:00 UTC |
| `nurture-sequence` | GitHub Actions | Mon-Fri 12:00 UTC (= 09:00 ART) |
| Calendly webhook | Edge Function en Supabase | Deployado pero **bloqueado** (Free plan no permite webhooks API) |

### Quality
- Vitest: 33 tests unitarios pasando
- Biome lint
- TypeScript strict
- 6 paquetes con `pnpm typecheck`

---

## 2. Lo que falta

### Bloqueado por billing (decisión del founder)

| Item | Costo | Beneficio |
|------|-------|-----------|
| Calendly Standard | ~USD $16/mes | Webhook automático: meetings booked llegan al dashboard sin marcar a mano |
| Vercel Pro | USD $20/mes | Password protection nativo (innecesario, ya hay Google OAuth) |

### Nice to have, ordenado por impacto

1. **Tests para `buildDailySummary`** — la lógica crítica de KPIs no tiene cobertura
2. **Whitelist en env var** (vs hardcoded) — sumar/sacar gente sin redeploy
3. **Workflow GH Actions de `daily-review`** — opcional, ya que la página `/daily-review` cubre el caso de uso
4. **Slack/email notifications** — para enterarte cuando un workflow falla
5. **RLS policies + client SSR autenticado en pages** — defense in depth (hoy las pages usan service role bypasseando RLS, tras el middleware)
6. **Cron para `campaign-report`** — analytics semanales

### Acciones manuales pendientes (solo founder)
- ⚠️ **Revocar PAT de Calendly** que se compartió en chat (riesgo de seguridad)
- Decidir si upgrade a Calendly Standard (cuando empiece a doler el laburo manual)
- Decidir tier de monitoring (cuando el volumen de leads suba)

---

## 3. Roadmap de onboarding (para alguien nuevo)

### Día 1 — Comprensión

1. Leer [CLAUDE.md](../CLAUDE.md) (runbook operativo) y [architecture.md](architecture.md) (data flow detallado)
2. Tour del dashboard live: https://wobox-lead-engine-web.vercel.app (pedirle a Sebastián que whitelistee tu email primero)
3. Mirá los últimos commits: `git log --oneline -30` te muestra cómo evolucionó

### Día 2 — Setup local

```bash
git clone https://github.com/SebastianOberti/wobox-lead-engine
pnpm install
cp .env.example .env  # pedirle valores a Sebastián
pnpm skill health-check  # te dice qué falta
```

### Día 3 — Probar el pipeline end-to-end

```bash
# 1. Buscar 5 cafeterías en Palermo Soho
pnpm agent full-prospecting --venture=loop --subsector=cafeteria \
  --neighborhood="Palermo Soho" --limit=5

# 2. Generar mensajes para los qualified
pnpm skill generate-messages --venture=loop

# 3. En el dashboard /drafts: aprobar/editar/enviar uno

# 4. Marcar manual stage=meeting_booked en /pipeline si responde

# 5. Ver el estado: pnpm agent daily-review
```

### Día 4+ — Operación diaria (rutina del founder)

1. **Mañana** (5 min): abrir https://wobox-lead-engine-web.vercel.app/daily-review → ver qué pasó las últimas 24h
2. Si hay drafts esperando → `/drafts` → aprobar/editar/enviar
3. Si nurture hoy → `/nurture` → ver touchpoints + ejecutar
4. Cuando un lead acepta meeting → marcar manual en `/pipeline` (stage=meeting_booked)
5. (cron automático) `nurture-sequence` corre Mon-Fri 09:00 ART

---

## 4. Web walkthrough (script de demo, ~10 min)

### Paso 1: Login
- Abrir https://wobox-lead-engine-web.vercel.app
- Mostrar que redirige a `/login` → "es un dashboard interno, solo para nuestro equipo"
- Click "Sign in with Google" → entrar con tu cuenta de Wobox

### Paso 2: Home `/`
- "Acá ves el pipeline total: cuántas companies hay en cada stage del funnel"
- "El concepto: empresas pasan por `new → enriched → qualified → nurturing → contacted → meeting_booked`"
- Mostrar conteos por venture (food / fashion / loop) — *"3 ventures distintos comparten infra pero scoring y mensajes son específicos"*

### Paso 3: Daily review `/daily-review`
- "Esto es el dashboard de actividad — qué se movió en las últimas 24h"
- Click filtros 1d/7d/30d para mostrar la flexibilidad
- "El breakdown por venture me dice dónde poner foco hoy"

### Paso 4: Pipeline `/pipeline`
- "Acá veo cada company individualmente — filtrar por venture y stage"
- "Si veo una que no me convence, click `Descartar` y desaparece del flujo"
- "Si una respondió y agendó meeting, cambio stage a `meeting_booked` desde acá"

### Paso 5: Drafts `/drafts`
- "Claude genera mensajes por mí, pero **siempre los reviso humano antes de mandar**"
- Mostrar un draft → "puedo aprobar tal cual, editar (queda registrado para mejorar el prompt), o descartar"
- "Cuando lo envío manual por LinkedIn / IG / mail, marco `Sent` acá y queda log"

### Paso 6: Nurture `/nurture`
- "Si un lead no respondió pero está cerca, entra en secuencia de nurture: 2 días, 5 días, 10 días"
- "Cada mañana esta lista me dice a quién tocar hoy"

### Paso 7: Campaigns `/campaigns`
- "Las campañas agrupan leads por iniciativa (ej: 'Cafeterías Palermo Q2')"
- Crear una nueva en vivo → mostrar status

### Paso 8: Bonus — CLI (si la audiencia es técnica)
- Abrir terminal: `pnpm agent daily-review`
- "Mismo dato que el dashboard, pero scriptable. Lo usamos en el cron de GitHub Actions que corre todos los días a las 9am"

---

## 5. Quick reference — comandos más usados

```bash
# Dev
pnpm dev                                      # dashboard en localhost:3000
pnpm typecheck                                # validar tipos
pnpm test                                     # vitest run
pnpm lint                                     # biome

# Operación
pnpm skill health-check                       # diagnostic
pnpm skill show-pipeline                      # estado actual
pnpm agent daily-review                       # resumen cross-venture
pnpm agent full-prospecting --venture=loop \
  --subsector=cafeteria --limit=10            # busqueda completa

# DB
pnpm db:types                                 # regenerar tipos Supabase
pnpm skill setup-database                     # aplicar migrations
```
