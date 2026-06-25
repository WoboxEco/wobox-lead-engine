'use client';

import { useActionState } from 'react';
import { unlockContact } from './actions';

export function UnlockButton({ contactId }: { contactId: string }) {
  const [error, dispatch, isPending] = useActionState(unlockContact, null);

  return (
    <form action={dispatch} className="inline-flex items-center gap-1">
      <input type="hidden" name="contactId" value={contactId} />
      <button
        type="submit"
        disabled={isPending}
        title="Desbloquear email (gasta 1 crédito Apollo)"
        className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
      >
        {isPending ? '⏳' : '🔓'}
      </button>
      {error && (
        <span className="text-[11px] text-[oklch(0.75_0.18_25)]" title={error}>
          ✗
        </span>
      )}
    </form>
  );
}
