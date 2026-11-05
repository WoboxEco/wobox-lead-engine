'use client';

import { Check, Loader2, Pencil, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { discardDraft, saveEmailDraft, sendDraft } from './actions';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  id: string;
  status: string;
  to: string;
  subject: string;
  body: string;
  btnPrimary: string;
  btnSecondary: string;
  btnDanger: string;
  inputCls: string;
}

/**
 * Card editable de un draft de email. "Para:", asunto y cuerpo viven en UN solo form:
 * Enviar manda exactamente lo que se ve (no hace falta "Guardar" antes) y pide
 * confirmación con el email exacto que se va a usar.
 */
export function EmailDraftForm(props: Props) {
  const { id, status, btnPrimary, btnSecondary, btnDanger, inputCls } = props;
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [to, setTo] = useState(props.to);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toClean = to.trim().toLowerCase();
  const validTo = EMAIL_RE.test(toClean);

  function onSend() {
    const form = formRef.current;
    if (!form) return;
    setError(null);
    if (!form.reportValidity()) return;
    if (!validTo) {
      setError(`Email inválido: ${toClean || '(vacío)'}`);
      return;
    }
    if (!window.confirm(`¿Enviar a ${toClean}?`)) return;

    const fd = new FormData(form);
    fd.set('to', toClean);
    startTransition(async () => {
      const res = await sendDraft(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // El draft sale de la lista: el aviso va por URL para que sobreviva al re-render.
      const url = new URL(window.location.href);
      url.searchParams.set('sent', res.to ?? toClean);
      router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  return (
    <form ref={formRef} action={saveEmailDraft} className="mt-4 space-y-2 text-[13px]">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={`to-${id}`} className="text-muted text-[11px] uppercase tracking-[0.08em]">
          Para:
        </label>
        <input
          id={`to-${id}`}
          type="email"
          name="to"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="email@empresa.com"
          className={`${inputCls} w-auto min-w-[260px] py-1`}
        />
        {props.to && toClean !== props.to.trim().toLowerCase() ? (
          <span className="text-[11px] text-[oklch(0.78_0.16_75)]">
            original: <span className="mono">{props.to}</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label
          htmlFor={`subject-${id}`}
          className="text-muted text-[11px] uppercase tracking-[0.08em]"
        >
          Asunto:
        </label>
        <input
          id={`subject-${id}`}
          name="subject"
          required
          defaultValue={props.subject}
          placeholder="Asunto del email"
          className={`${inputCls} w-auto min-w-[260px] flex-1 max-w-xl py-1`}
        />
      </div>
      <textarea
        name="body"
        required
        defaultValue={props.body}
        rows={8}
        className={`${inputCls} font-sans resize-y max-w-3xl leading-relaxed`}
      />

      {error ? <p className="text-[12.5px] text-[oklch(0.75_0.18_25)]">{error}</p> : null}

      <div className="pt-2 flex items-center gap-2 flex-wrap">
        {status === 'draft' ? (
          <button
            type="submit"
            name="approve"
            value="1"
            disabled={isPending}
            className={btnPrimary}
          >
            <Check size={14} /> Guardar y aprobar
          </button>
        ) : null}
        <button type="submit" disabled={isPending} className={btnSecondary}>
          <Pencil size={14} /> Guardar
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={isPending || !validTo}
          title={
            validTo ? `Enviar a ${toClean}` : 'Cargá un email válido en "Para:" para poder enviar'
          }
          className={`${btnSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {validTo ? `Enviar a ${toClean}` : 'Falta email'}
        </button>
        <button
          type="submit"
          formAction={discardDraft}
          formNoValidate
          disabled={isPending}
          className={btnDanger}
        >
          <Trash2 size={14} /> Descartar
        </button>
      </div>
    </form>
  );
}
