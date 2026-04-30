'use client';

import type { ChangeEvent } from 'react';
import { changeVenture } from './actions';

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'loop', label: 'Loop' },
  { value: 'wobox_food', label: 'Wobox Food' },
  { value: 'wobox_fashion', label: 'Wobox Fashion' },
];

export function VentureSelect({
  companyId,
  defaultValue,
}: {
  companyId: string;
  defaultValue: string;
}) {
  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    e.currentTarget.form?.requestSubmit();
  }
  return (
    <form action={changeVenture} className="inline-block">
      <input type="hidden" name="id" value={companyId} />
      <select
        name="venture"
        defaultValue={defaultValue}
        onChange={onChange}
        className="bg-transparent border-0 text-[13px] px-1 py-0.5 -mx-1 rounded hover:bg-[var(--surface-elevated)] cursor-pointer focus:outline-none focus:bg-[var(--surface-elevated)] appearance-none pr-5"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.25rem center',
          backgroundSize: '0.7rem',
        }}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
