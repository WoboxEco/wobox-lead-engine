'use client';

import { useState } from 'react';

export function UnlockButton({ contactId }: { contactId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleClick() {
    setState('loading');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch('/api/unlock-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json() as { email?: string; error?: string };
      if (!res.ok || data.error) {
        setMessage(data.error ?? 'Error desconocido');
        setState('error');
      } else {
        setMessage(data.email ?? 'Desbloqueado (sin email público)');
        setState('done');
        // Recarga la página para reflejar el cambio
        window.location.reload();
      }
    } catch (err) {
      setMessage(err instanceof Error && err.name === 'AbortError' ? 'Timeout — Apollo tardó demasiado' : String(err));
      setState('error');
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
        <span className="text-[11px] text-[oklch(0.75_0.18_25)]" title={message}>✗</span>
      )}
    </span>
  );
}
