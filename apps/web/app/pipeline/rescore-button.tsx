'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Debe coincidir con MAX_RESCORE_IDS_PER_REQUEST de @wobox/skills/rescore-discarded. */
const CHUNK_SIZE = 2;

async function post<T>(body: unknown): Promise<T | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  try {
    const res = await fetch('/api/rescore-discarded', {
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

/** "Re-puntuar descartados" (Wobox Fashion, score 35–49) con el scoring v2, en lotes. */
export function RescoreButton() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  async function runRescore() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      setProgress('Buscando descartados con score 35–49…');
      const plan = await post<{ ids: string[] }>({});
      if ('error' in plan) {
        setResult(`Error: ${plan.error.slice(0, 200)}`);
        return;
      }
      const ids = plan.ids ?? [];
      let ok = 0;
      let qualified = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        setProgress(`Re-puntuando ${i + chunk.length}/${ids.length}…`);
        const r = await post<{ ok: number; failed: number; qualified: number }>({ ids: chunk });
        if ('error' in r) {
          failed += chunk.length;
          continue;
        }
        ok += r.ok ?? 0;
        failed += r.failed ?? 0;
        qualified += r.qualified ?? 0;
      }
      setResult(
        ids.length === 0
          ? 'No hay descartados con score 35–49 pendientes de re-puntuar.'
          : `${ok} re-puntuados, ${qualified} pasaron a calificados, ${ok - qualified} siguen descartados${failed ? `, ${failed} fallaron` : ''}.`,
      );
    } finally {
      setProgress(null);
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => void runRescore()}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[var(--border)] hover:bg-[var(--surface-elevated)] transition-colors disabled:opacity-50"
        title="Re-puntúa con el scoring v2 los Wobox Fashion descartados con score entre 35 y 49"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
        Re-puntuar descartados
      </button>
      {running ? (
        <span className="text-[12.5px] text-muted">
          {progress ?? 'Procesando…'} No cierres la pestaña.
        </span>
      ) : null}
      {result ? <span className="text-[12.5px] text-muted-strong font-mono">{result}</span> : null}
    </div>
  );
}
