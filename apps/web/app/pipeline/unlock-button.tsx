'use client';

import { useTransition } from 'react';
import { unlockContact } from './actions';

export function UnlockButton({ contactId }: { contactId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await unlockContact(formData);
      } catch (err) {
        alert(`Error al desbloquear: ${String(err).replace('Error: ', '')}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="inline">
      <input type="hidden" name="contactId" value={contactId} />
      <button
        type="submit"
        disabled={isPending}
        title="Desbloquear email (gasta 1 crédito Apollo)"
        className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--border)] text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-40"
      >
        {isPending ? '⏳' : '🔓'}
      </button>
    </form>
  );
}
