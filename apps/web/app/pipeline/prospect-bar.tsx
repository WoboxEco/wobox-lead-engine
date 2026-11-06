'use client';

import {
  PROSPECT_REGIONS,
  type SearchLeadsResult,
  formatProspectSummary,
} from '@wobox/skills/prospect-summary';
import { type GenerateFailure, formatGenerateSummary } from '@wobox/skills/summary';
import { Loader2, Phone, Search, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Companies por request a /api/generate-messages (cada draft tarda ~3-8s en Claude). */
const GENERATE_CHUNK_SIZE = 2;

/** Companies por request a /api/score-leads (máx MAX_SCORE_IDS_PER_REQUEST = 3). */
const SCORE_CHUNK_SIZE = 3;

const VENTURES = [
  { value: 'wobox_fashion', label: 'Wobox Fashion' },
  { value: 'wobox_food', label: 'Wobox Food' },
  { value: 'loop', label: 'Loop' },
];

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'instagram_dm', label: 'Instagram DM' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Llamada (guion)' },
];

const FASHION_SUBSECTORS = [
  { value: 'todos', label: 'Todos' },
  { value: 'ropa', label: 'Ropa' },
  { value: 'calzado', label: 'Calzado' },
  { value: 'muebles_deco', label: 'Muebles / Deco' },
];

const selectClass =
  'bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]';
const labelClass = 'text-[11.5px] text-muted';

export function ProspectBar({ defaultVenture }: { defaultVenture: string }) {
  const [running, setRunning] = useState<'prospect' | 'messages' | 'enrich' | null>(null);
  const [result, setResult] = useState<{ which: 'prospect' | 'messages'; text: string } | null>(
    null,
  );
  const [enrichText, setEnrichText] = useState<string | null>(null);

  const initialVenture = defaultVenture || 'wobox_fashion';
  const [prospectVenture, setProspectVenture] = useState(initialVenture);
  const [prospectLimit, setProspectLimit] = useState('25');
  const [subsector, setSubsector] = useState('todos');
  const [region, setRegion] = useState<string>(PROSPECT_REGIONS[0].value);
  const [msgVenture, setMsgVenture] = useState(initialVenture);
  const [channel, setChannel] = useState('email');
  const [regenerate, setRegenerate] = useState(false);
  const [retryNoEmail, setRetryNoEmail] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const router = useRouter();

  // Estado propio en vez de useTransition: con revalidatePath el pending de la transición podía
  // quedar colgado y dejaba los botones deshabilitados hasta recargar la página.
  const busy = running !== null;

  async function run(which: 'prospect' | 'messages', task: () => Promise<string>) {
    if (running) return;
    setResult(null);
    setProgress(null);
    setRunning(which);
    try {
      const text = await task();
      setResult({ which, text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ which, text: `Error: ${msg.slice(0, 200)}` });
    } finally {
      setProgress(null);
      setRunning(null);
      // Refresca la tabla (server component) sin recargar: el resultado queda en pantalla.
      router.refresh();
    }
  }

  function runProspect() {
    const venture = prospectVenture;
    const body: Record<string, unknown> = { venture, limit: prospectLimit };
    if (venture === 'wobox_fashion') body.subsector = subsector;
    if (venture !== 'loop') body.region = region;
    setEnrichText(null);
    void run('prospect', async () => {
      const text = await prospectInSteps({ venture, body, onProgress: setProgress });
      // Después del prospect: Google Maps para los que quedaron sin teléfono.
      if (!text.startsWith('Error')) {
        await runEnrich(venture);
      }
      return text;
    });
  }

  /** Llama /api/enrich (scrape website + Google Maps si falta telefono, tope 10). */
  async function runEnrich(venture: string) {
    setEnrichText('Buscando teléfonos / WhatsApp / email… (hasta ~1 min)');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65000);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venture }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        processed?: number;
        updated?: number;
        mapsLookups?: number;
        pendingMaps?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setEnrichText(`Enriquecer: ${data.error ?? `HTTP ${res.status}`}`);
      } else {
        setEnrichText(
          `Contactos: ${data.updated}/${data.processed} con datos nuevos · ${data.mapsLookups} búsquedas Maps${data.pendingMaps ? ` · ${data.pendingMaps} pendientes (volvé a correr)` : ''}`,
        );
        router.refresh();
      }
    } catch (err) {
      setEnrichText(
        err instanceof Error && err.name === 'AbortError'
          ? 'Enriquecer: timeout (lo ya encontrado quedó guardado; volvé a correr)'
          : `Enriquecer: ${String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function runEnrichOnly() {
    if (running) return;
    setResult(null);
    setRunning('enrich');
    void runEnrich(prospectVenture).finally(() => {
      setRunning(null);
      router.refresh();
    });
  }

  function runMessages() {
    const venture = msgVenture;
    const ch = channel;
    void run('messages', () =>
      generateInBatches({
        venture,
        channel: ch,
        regenerate,
        retryNoEmail: ch === 'email' && retryNoEmail,
        onProgress: setProgress,
      }),
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Card 1: Prospectar leads nuevos */}
      <div className="surface p-4 flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Search size={15} className="text-accent" />
            <h2 className="text-[14px] font-semibold">Prospectar leads nuevos</h2>
          </div>
          <p className={`${labelClass} mt-1`}>
            Trae leads nuevos (Apollo o web), busca teléfono / WhatsApp / email en su web y los
            puntúa con IA. Apollo gasta 1 crédito por página (máx 3 si las primeras solo traen
            duplicados); Google Maps ~1 crédito Apify por lead sin teléfono.
          </p>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Negocio a prospectar</span>
            <select
              value={prospectVenture}
              onChange={(e) => setProspectVenture(e.target.value)}
              disabled={busy}
              className={selectClass}
            >
              {VENTURES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          {prospectVenture === 'wobox_fashion' ? (
            <div className="flex flex-col gap-1">
              <span className={labelClass}>Rubro</span>
              <select
                value={subsector}
                onChange={(e) => setSubsector(e.target.value)}
                disabled={busy}
                className={selectClass}
              >
                {FASHION_SUBSECTORS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {prospectVenture !== 'loop' ? (
            <div className="flex flex-col gap-1">
              <span className={labelClass}>Región</span>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={busy}
                className={selectClass}
              >
                {PROSPECT_REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Cantidad</span>
            <input
              type="number"
              value={prospectLimit}
              onChange={(e) => setProspectLimit(e.target.value)}
              disabled={busy}
              className={`${selectClass} w-24`}
              min={1}
              max={100}
            />
          </div>
          <button
            type="button"
            onClick={runProspect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {running === 'prospect' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            + Prospect
          </button>
          <button
            type="button"
            onClick={runEnrichOnly}
            disabled={busy}
            title="Scrape del website + Google Maps si falta teléfono (~1 crédito Apify c/u, tope 10)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[var(--border)] hover:bg-[var(--surface-elevated)] transition-colors disabled:opacity-50"
          >
            {running === 'enrich' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Phone size={14} />
            )}
            Enriquecer contactos
          </button>
        </div>

        {running === 'prospect' ? (
          <p className="text-[12.5px] text-muted">
            {progress ?? 'Procesando…'} No cierres la pestaña.
          </p>
        ) : null}
        {result?.which === 'prospect' ? (
          <p className="text-[12.5px] text-muted-strong font-mono break-words">{result.text}</p>
        ) : null}
        {enrichText ? (
          <p className="text-[12.5px] text-muted-strong font-mono break-words">{enrichText}</p>
        ) : null}
      </div>

      {/* Card 2: Generar mensajes */}
      <div className="surface p-4 flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h2 className="text-[14px] font-semibold">Generar mensajes</h2>
          </div>
          <p className={`${labelClass} mt-1`}>
            Redacta drafts para los leads <em>qualified</em>. Email: revela el contacto en Apollo (1
            crédito c/u, máx 10) y se envía desde /drafts. Otros canales: copiás y mandás.
          </p>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Negocio</span>
            <select
              value={msgVenture}
              onChange={(e) => setMsgVenture(e.target.value)}
              disabled={busy}
              className={selectClass}
            >
              {VENTURES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Canal (formato del mensaje)</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              disabled={busy}
              className={selectClass}
            >
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={runMessages}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[var(--border)] hover:bg-[var(--surface-elevated)] transition-colors disabled:opacity-50"
          >
            {running === 'messages' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Generar mensajes
          </button>
        </div>

        <label className="text-[12.5px] text-muted-strong flex items-center gap-2">
          <input
            type="checkbox"
            checked={regenerate}
            onChange={(e) => setRegenerate(e.target.checked)}
            disabled={busy}
            className="accent-[var(--accent)]"
          />
          Regenerar (descarta los borradores pendientes de este negocio y canal)
        </label>
        {channel === 'email' ? (
          <label className="text-[12.5px] text-muted-strong flex items-center gap-2">
            <input
              type="checkbox"
              checked={retryNoEmail}
              onChange={(e) => setRetryNoEmail(e.target.checked)}
              disabled={busy}
              className="accent-[var(--accent)]"
            />
            Reintentar emails no encontrados (ignora el intento previo en Apollo, gasta créditos)
          </label>
        ) : null}

        {running === 'messages' ? (
          <p className="text-[12.5px] text-muted">
            {progress ?? 'Procesando…'} No cierres la pestaña.
          </p>
        ) : null}
        {result?.which === 'messages' ? (
          <p className="text-[12.5px] text-muted-strong font-mono break-words">{result.text}</p>
        ) : null}
      </div>
    </div>
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok || data.error) return { error: data.error ?? `HTTP ${res.status}` };
    return data;
  } catch (err) {
    return { error: err instanceof Error && err.name === 'AbortError' ? 'timeout' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sourcing (/api/prospect) → scoring por lotes (/api/score-leads), en requests separadas
 * para no pasar el timeout de Vercel Hobby. Devuelve el resumen final.
 */
async function prospectInSteps(args: {
  venture: string;
  body: Record<string, unknown>;
  onProgress: (text: string) => void;
}): Promise<string> {
  const { venture, body, onProgress } = args;
  onProgress(venture === 'loop' ? 'Buscando leads en la web…' : 'Buscando leads en Apollo…');
  const src = await postJson<{
    search: SearchLeadsResult | null;
    toScore: string[];
    channels?: { processed: number; updated: number; error?: string } | null;
  }>('/api/prospect', body);
  if ('error' in src) return `Error en sourcing: ${src.error.slice(0, 200)}`;

  const toScore = Array.isArray(src.toScore) ? src.toScore : [];
  let qualified = 0;
  let scored = 0;
  const errors: string[] = [];
  for (let i = 0; i < toScore.length; i += SCORE_CHUNK_SIZE) {
    const ids = toScore.slice(i, i + SCORE_CHUNK_SIZE);
    onProgress(`Puntuando ${i + ids.length}/${toScore.length}…`);
    const r = await postJson<{ ok: number; failed: number; qualified: number }>(
      '/api/score-leads',
      { venture, ids },
    );
    if ('error' in r) {
      errors.push(r.error);
      continue;
    }
    scored += r.ok ?? 0;
    qualified += r.qualified ?? 0;
  }
  const scoringNote = errors.length
    ? ` · ${errors.length} lote(s) de scoring fallaron: ${errors[0]?.slice(0, 120)}`
    : '';

  const ch = src.channels;
  const channelsNote = !ch
    ? ''
    : ch.error
      ? ` · scrape de canales falló: ${ch.error}`
      : ` · canales: ${ch.updated}/${ch.processed} con datos del website`;

  if (!src.search) {
    // Loop (Apify): sin conteo de nuevos/duplicados.
    return `${scored} puntuados, ${qualified} calificados${scoringNote}${channelsNote}`;
  }
  return `${formatProspectSummary(src.search, errors.length && !scored ? null : qualified)}${scoringNote}${channelsNote}`;
}

/** Auto-reveal de emails vía API route (fuera de la server action por el timeout de Vercel). */
type RevealFailure = { company: string; contact: string | null; reason: string };

async function revealEmails(
  venture: string,
  force: boolean,
  retryNoEmail: boolean,
): Promise<{ revealed: number; credits: number; failures: RevealFailure[]; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const res = await fetch('/api/reveal-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venture, force, retryNoEmail }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      revealed?: number;
      credits?: number;
      failures?: RevealFailure[];
      error?: string;
    };
    if (!res.ok || data.error) {
      return { revealed: 0, credits: 0, failures: [], error: data.error ?? `HTTP ${res.status}` };
    }
    return {
      revealed: data.revealed ?? 0,
      credits: data.credits ?? 0,
      failures: Array.isArray(data.failures) ? data.failures : [],
    };
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? 'timeout Apollo' : String(err);
    return { revealed: 0, credits: 0, failures: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

type GenerateResponse = {
  ok?: number;
  noEmail?: number;
  noContacts?: number;
  failures?: GenerateFailure[];
  pending?: string[];
  error?: string;
};

async function postGenerate(body: Record<string, unknown>): Promise<GenerateResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  try {
    const res = await fetch('/api/generate-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as GenerateResponse;
    if (!res.ok || data.error) return { error: data.error ?? `HTTP ${res.status}` };
    return data;
  } catch (err) {
    return { error: err instanceof Error && err.name === 'AbortError' ? 'timeout' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reveal (solo email) → plan → genera de a GENERATE_CHUNK_SIZE companies por request,
 * así ninguna request pasa el timeout de Vercel Hobby. Devuelve el resumen final.
 */
async function generateInBatches(args: {
  venture: string;
  channel: string;
  regenerate: boolean;
  retryNoEmail: boolean;
  onProgress: (text: string) => void;
}): Promise<string> {
  const { venture, channel, regenerate, retryNoEmail, onProgress } = args;
  const isEmail = channel === 'email';

  let reveal: Awaited<ReturnType<typeof revealEmails>> | null = null;
  if (isEmail) {
    onProgress('Revelando emails en Apollo…');
    reveal = await revealEmails(venture, regenerate, retryNoEmail);
  }

  onProgress('Buscando leads a redactar…');
  const plan = await postGenerate({ venture, channel, regenerate });
  if (plan.error) return `Error: ${plan.error.slice(0, 200)}`;
  const pending = plan.pending ?? [];

  let ok = 0;
  const failures: Array<{ reason: string }> = [];
  for (let i = 0; i < pending.length; i += GENERATE_CHUNK_SIZE) {
    const ids = pending.slice(i, i + GENERATE_CHUNK_SIZE);
    onProgress(`Generando ${i + ids.length}/${pending.length}…`);
    const r = await postGenerate({ venture, channel, regenerate, ids });
    if (r.error) {
      // La request entera falló (timeout, 500): cuenta como fallo de cada company del lote.
      for (const _ of ids) failures.push({ reason: `request falló: ${r.error.slice(0, 120)}` });
      continue;
    }
    ok += r.ok ?? 0;
    failures.push(...(r.failures ?? []));
  }

  return formatGenerateSummary({
    channel,
    ok,
    noEmail: plan.noEmail ?? 0,
    noContacts: plan.noContacts ?? 0,
    failures,
    ...(reveal
      ? {
          revealed: reveal.revealed,
          credits: reveal.credits,
          revealFailures: reveal.failures,
          ...(reveal.error ? { revealError: reveal.error } : {}),
        }
      : {}),
  });
}
