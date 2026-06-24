# Guía completa — Wobox Lead Engine

> Documento de onboarding integral. Si nunca viste el proyecto, leé esto de arriba a abajo.
> Última actualización: 2026-06-24.

---

## 1. Qué es (y qué no es)

**Wobox Lead Engine** es un motor de **prospección outbound** para tres negocios: Wobox Food, Wobox Fashion y Loop. Automatiza la parte tediosa de prospectar: **encontrar** empresas que encajan, **enriquecerlas** con datos, **puntuarlas** con IA y **escribir** el mensaje de primer contacto personalizado.

**Lo que SÍ hace (automatizado):**
- Sourcing de empresas desde varias fuentes (Apollo, scraping de cámaras, Google Maps, CSV).
- Enriquecimiento (followers de Instagram, scrape de la web).
- Scoring con IA (Claude) que califica y rankea cada lead.
- Redacción de mensajes de outreach personalizados, adaptados al canal.
- Secuencias de seguimiento (nurture).

**Lo que NO hace (importante):**
- **No envía mensajes solo.** Redacta el borrador; un humano lo revisa, aprueba y lo manda **a mano** (copiar/pegar a Instagram, mail, etc.). Es un asistente con humano en el loop, no un bot de envío masivo.
- **No corre hosteado.** Hoy es una herramienta **local**: corre en la máquina del operador (`pnpm dev` + comandos de terminal).
- El booking automático de Calendly está bloqueado (el plan free no da webhooks); se marca a mano.

**En una frase:** automatiza el 80% tedioso (investigar + escribir), y deja la curaduría y el envío a una persona.

---

## 2. Los tres negocios (ventures)

El "venture" es el concepto central. No es solo un filtro: define **a quién** se prospecta, **cómo** se puntúa y **cómo** se redactan los mensajes.

| Venture | Cliente objetivo (ICP) | Fuentes de leads |
|---|---|---|
| **Wobox Food** | Supermercados, alimentos, productores con marca | CAS (cámara), Apollo, Apify Maps |
| **Wobox Fashion** | Marcas de indumentaria / calzado | Apollo, CSV de Sales Navigator |
| **Loop** | Cadenas de gastronomía / wellness / retail | Apify Maps (por barrio) |

Cada venture tiene su propio criterio de scoring y sus propias plantillas de mensaje (la propuesta de valor de Food no es la de Fashion).

---

## 3. El pipeline end-to-end

Cada lead avanza por **stages** (estados). El flujo:

```
   FUENTES                 ENRIQUECER        IA               WARM PATH          IA
   ───────                 ──────────        ──               ─────────          ──
   search-leads (Apollo) ─┐
   sourcing-cas (CAS)    ─┼─► enrich-lead ─► score-leads ──► check-warm-path ─► generate-messages
   search-leads-web      ─┤   (web + IG)     ≥50 qualified    (revela email      (escribe draft)
   import-csv            ─┘                  <50 discarded     1 cr c/u)              │
                                                                                      ▼
              sync-hubspot ◄─ Calendly ◄─ nurture-sequence ◄─ approve-message ◄──────┘
              (CRM)           (reunión)    (follow-ups)        (humano aprueba+envía)
```

### Stages de una company
`new` → `enriched` → `qualified` (o `discarded`) → `nurturing` → `contacted` → `meeting_booked`

- **new**: recién sourced, sin procesar.
- **enriched**: ya tiene followers / datos de web.
- **qualified**: score ≥ 50 (umbral). Listo para contactar.
- **discarded**: score < 50, o descartado a mano. (Se puede reactivar.)
- **nurturing / contacted / meeting_booked**: avanza según interacción.

---

## 4. Las funcionalidades (skills), una por una

Cada skill es un comando: `pnpm skill <nombre> [flags]`. La columna "Gasta" indica qué recurso consume.

| Skill | Gasta | Qué hace |
|---|---|---|
| `setup-database` | — | Crea/actualiza el schema en Supabase (idempotente). |
| `health-check` | — | Valida que todas las API keys autentiquen. Corrélo primero. |
| `search-leads` | Apollo (1 cr) | Busca empresas en Apollo según el venture (industrias + país + tamaño) e inserta company + nombres de decision-makers. `--dry-run` previsualiza sin insertar. |
| `sourcing-cas` | — (scrape) | Scrapea el directorio de la Cámara Arg. de Supermercados → leads de food con email. Gratis. |
| `search-leads-web` | Apify + Claude | Google Maps + Instagram por barrio (para Loop). |
| `import-csv` | — | Import bulk desde un CSV (ej. export de Sales Navigator). |
| `enrich-lead` | Apify | Busca el Instagram (scrapeando la web) y trae followers. `new → enriched`. |
| `score-leads` | Claude | Puntúa cada lead 0-100 en varias dimensiones. **≥50 → qualified, <50 → discarded.** |
| `check-warm-path` | Apollo (1 cr al revelar) | Detecta conexiones / revela el email del contacto. |
| `generate-messages` | Claude | Escribe el draft personalizado. `--id` (uno) o `--all` (batch por venture/stage). |
| `approve-message` | — | Aprobar / editar / enviar / descartar un draft. |
| `nurture-sequence` | Claude | Genera follow-ups según calendario (días 2/5/10). |
| `sync-hubspot` | — | Empuja reuniones a HubSpot, trae cierres. |
| `show-pipeline` / `show-metrics` | — | Lectura: estado del pipeline / KPIs. |

### Agentes (orquestadores)
Un agente encadena varias skills: `pnpm agent <nombre>`.
- `full-prospecting`: search → enrich → score → check-warm-path en una corrida.

---

## 5. El dashboard (Next.js)

Corre con `pnpm dev` → http://localhost:3000. Login con Google + whitelist de emails ([apps/web/lib/auth/whitelist.ts](../apps/web/lib/auth/whitelist.ts)).

| Ruta | Qué muestra |
|---|---|
| `/` | Counts por stage y venture. |
| `/pipeline` | Tabla de empresas (filtrable). **Botones de acción** (ver abajo). Cambiar stage / descartar. |
| `/drafts` | Los mensajes generados, para aprobar / editar / enviar. |
| `/nurture` | A quién seguir hoy. |
| `/daily-review` | Resumen cross-venture. |

### Botones de acción en /pipeline
Dos tarjetas que disparan el pipeline **sin usar la terminal** (corren las skills como subproceso):
- **🔍 Prospectar leads nuevos** (`+ Prospect`): elegís venture + cantidad → trae N leads de Apollo y los puntúa. Gasta 1 crédito Apollo.
- **✨ Generar mensajes**: elegís venture + canal → redacta drafts para los qualified. Gasta tokens Claude.

El canal (Instagram DM / Email / LinkedIn / WhatsApp) define el **formato y tono** del mensaje, no envía por esa red.

---

## 6. Cómo se opera día a día

Hoy la tool requiere **dos roles**:

**Operador técnico** (vos): corre el pipeline. Por terminal o por los botones del dashboard.
1. `+ Prospect` (o `pnpm agent full-prospecting`) → trae y puntúa leads.
2. Revisa que los qualified tengan sentido (ajusta filtros si entra ruido).
3. `Generar mensajes` → llena `/drafts`.

**Comercial / vendedor**: trabaja los drafts en el dashboard.
1. Abre `/drafts` → lee el mensaje ya escrito y personalizado.
2. Ajusta si quiere → aprueba.
3. **Copia y envía a mano** por la red correspondiente.
4. `/nurture` → manda los follow-ups del día.
5. `/pipeline` → marca reuniones agendadas.

> El comercial no busca ni escribe desde cero: solo cura y envía. Ese es el ahorro de tiempo.

---

## 7. Modelo de costos

| Recurso | Qué lo consume | Notas |
|---|---|---|
| **Créditos Apollo** | `search-leads` (1 cr/búsqueda) · `check-warm-path --auto-reveal` (1 cr/email) | Free tier limitado. La calidad en AR es buena para empresas formales (cadenas, marcas medianas), floja para PyMEs muy chicas. |
| **Tokens Claude** | `score-leads`, `generate-messages`, `nurture-sequence` | Baratos. Scoring usa Haiku; mensajes usan Sonnet (mejor redacción). Prompt caching reduce costo en batch. |
| **Apify** | `enrich-lead`, `search-leads-web` | Plan free con límites de scraping. |
| **CAS / import-csv** | Gratis | Scraping de cámara / archivo local. |

**Regla de oro:** revelar emails (Apollo) **solo de los qualified**, después del scoring, para no quemar créditos en leads que ibas a descartar igual.

---

## 8. Estado actual (2026-06-24)

- **Hosting:** local-only (decisión tomada). No está en ningún servidor.
- **Datos cargados:**
  - `wobox_fashion`: 25 leads de Apollo → 19 qualified (enriquecidos con followers) → 11 drafts generados.
  - `wobox_food`: ~30 leads de Apify Maps. `sourcing-cas` está listo para sumar ~178 socios de la cámara.
  - `loop`: parte de los 30 iniciales.
- **APIs:** Apollo, Apify (free), Claude, HubSpot autenticando. Calendly en modo manual.
- **Repo:** github.com/SebastianOberti/wobox-lead-engine (`main`).

---

## 9. Limitaciones conocidas y pendientes

- **No envía solo** ni tiene integración de envío (por diseño / deliverability).
- **Calendly free** no permite webhooks → reuniones se marcan a mano en `/pipeline`.
- **Apollo no devuelve decision-maker** para todas las empresas (de las 19 fashion qualified, 8 quedaron sin contacto → no se les pudo generar mensaje).
- **Sales Navigator** no exporta CSV nativo: requiere una herramienta de extracción (Evaboot/PhantomBuster) o usar Apollo como alternativa.
- **Handoff a un comercial**: hoy requiere que trabaje en la máquina del operador (es local). Para self-service haría falta hosting accesible + botones que ya existen + manejo de accesos.
- **Pendiente de seguridad:** revocar un PAT de Calendly que se expuso en chat.

---

## 10. Setup desde cero (otra máquina)

```bash
git clone https://github.com/SebastianOberti/wobox-lead-engine.git
cd wobox-lead-engine
pnpm install
cp .env.example .env        # completar las keys (mínimo SUPABASE_* + ANTHROPIC_API_KEY)
pnpm skill setup-database   # crea el schema
pnpm db:types               # genera tipos
pnpm skill health-check     # valida credenciales
pnpm dev                    # dashboard en localhost:3000
```

Requisitos: Node 22+, pnpm 9+, un proyecto Supabase.

---

## 11. Dónde está cada cosa (mapa del repo)

```
apps/web/             Dashboard Next.js (pipeline, drafts, nurture)
packages/core/        Env, cliente DB, logger, tipos de dominio
packages/prompts/     Prompts versionados (scoring + mensajes) en markdown
packages/integrations Wrappers de cada API (Claude, Apollo, Apify, HubSpot, Calendly)
packages/skills/      Las skills (CLI: pnpm skill <n>)
packages/agents/      Orquestadores (pnpm agent <n>)
supabase/migrations/  Schema + RLS + pg_cron
supabase/functions/   Edge Function (webhook Calendly)
docs/                 Esta guía + arquitectura + spec técnica
CLAUDE.md             Runbook operativo
```

### Otros documentos
- `README.md` — quickstart.
- `CLAUDE.md` — runbook operativo (comandos, convenciones).
- `docs/architecture.md` — data flow técnico.
- `docs/handoff.md` — status + roadmap histórico.
- `docs/wobox-lead-engine-FINAL.md` — spec técnica completa original.
- `docs/wobox-lead-engine-como-funciona.md` — overview funcional original.
