'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Copia el texto del draft al portapapeles (canales que se mandan a mano). */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar texto'}
    </button>
  );
}
