'use client';

import { Loader2, Search, Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { generateMessagesAction, prospectAction } from './prospect-actions';

const VENTURES = [
  { value: 'wobox_fashion', label: 'Wobox Fashion' },
  { value: 'wobox_food', label: 'Wobox Food' },
  { value: 'loop', label: 'Loop' },
];

const CHANNELS = [
  { value: 'instagram_dm', label: 'Instagram DM' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const selectClass =
  'bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:border-[var(--border-strong)]';
const labelClass = 'text-[11.5px] text-muted';

export function ProspectBar({ defaultVenture }: { defaultVenture: string }) {
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<'prospect' | 'messages' | null>(null);
  const [result, setResult] = useState<{ which: 'prospect' | 'messages'; text: string } | null>(
    null,
  );

  const initialVenture = defaultVenture || 'wobox_fashion';
  const [prospectVenture, setProspectVenture] = useState(initialVenture);
  const [prospectLimit, setProspectLimit] = useState('25');
  const [msgVenture, setMsgVenture] = useState(initialVenture);
  const [channel, setChannel] = useState('instagram_dm');

  function runProspect() {
    setResult(null);
    setRunning('prospect');
    const fd = new FormData();
    fd.set('venture', prospectVenture);
    fd.set('limit', prospectLimit);
    startTransition(async () => {
      const text = await prospectAction(fd);
      setResult({ which: 'prospect', text });
      setRunning(null);
    });
  }

  function runMessages() {
    setResult(null);
    setRunning('messages');
    const fd = new FormData();
    fd.set('venture', msgVenture);
    fd.set('channel', channel);
    startTransition(async () => {
      const text = await generateMessagesAction(fd);
      setResult({ which: 'messages', text });
      setRunning(null);
    });
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
            Trae leads nuevos de Apollo y los puntúa con IA. Gasta 1 crédito Apollo.
          </p>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Negocio a prospectar</span>
            <select
              value={prospectVenture}
              onChange={(e) => setProspectVenture(e.target.value)}
              disabled={isPending}
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
            <span className={labelClass}>Cantidad</span>
            <input
              type="number"
              value={prospectLimit}
              onChange={(e) => setProspectLimit(e.target.value)}
              disabled={isPending}
              className={`${selectClass} w-24`}
              min={1}
              max={100}
            />
          </div>
          <button
            type="button"
            onClick={runProspect}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 bg-accent text-[var(--accent-foreground)] px-3 py-1.5 rounded-md text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {running === 'prospect' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            + Prospect
          </button>
        </div>

        {running === 'prospect' ? (
          <p className="text-[12.5px] text-muted">Procesando… ~1 min. No cierres la pestaña.</p>
        ) : null}
        {result?.which === 'prospect' ? (
          <p className="text-[12.5px] text-muted-strong font-mono break-words">{result.text}</p>
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
            Redacta drafts para los leads <em>qualified</em>, adaptados al canal. Gasta tokens
            Claude. No envía: vos copiás y mandás.
          </p>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Negocio</span>
            <select
              value={msgVenture}
              onChange={(e) => setMsgVenture(e.target.value)}
              disabled={isPending}
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
              disabled={isPending}
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
            disabled={isPending}
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

        {running === 'messages' ? (
          <p className="text-[12.5px] text-muted">
            Procesando… 1-2 min. No cierres la pestaña.
          </p>
        ) : null}
        {result?.which === 'messages' ? (
          <p className="text-[12.5px] text-muted-strong font-mono break-words">{result.text}</p>
        ) : null}
      </div>
    </div>
  );
}
