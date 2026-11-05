'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UnlockButton({ contactId }: { contactId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const router = useRouter();

  async function handleClick() {
    setState('loading');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch('/api/unlock-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { email?: string; error?: string };
      if (!res.ok || data.error) {
        setMessage(data.error ?? 'Error desconocido');
        setState('error');
      } else {
        setMessage(data.email ?? 'Desbloqueado (sin email público)');
        setState('done');
        // Refresca la tabla sin recargar la página (no se pierde el estado del resto de la UI)
        router.refresh();
      }
    } catch (err) {
      setMessage(
        err instanceof Error && err.name === 'AbortError'
          ? 'Timeout — Apollo tardó demasiado'
          : String(err),
      );
      setState('error');
    } finally {
      clearTimeout(timer);
    }
  }

  if (state === 'done') return <span className="text-accent text-[11px]">✓</span>;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'loading'}
        title="Desbloquear email (gasta 1 crédito Apollo)"
        className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
      >
        {state === 'loading' ? '⏳' : '🔓'}
      </button>
      {state === 'error' && (
        <span className="text-[11px] text-[oklch(0.75_0.18_25)]" title={message}>
          ✗
        </span>
      )}
    </span>
  );
}
