import Link from 'next/link';
import { createManualDeal } from '../actions';

export const dynamic = 'force-dynamic';

const VENTURE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'wobox_food', label: 'Food' },
  { value: 'wobox_fashion', label: 'Fashion' },
  { value: 'loop', label: 'Loop' },
];

const STAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'deal_sin_contacto', label: 'Sin contacto' },
  { value: 'deal_contacto', label: 'Contacto' },
  { value: 'deal_presentacion', label: 'Presentacion' },
  { value: 'deal_negociacion', label: 'Negociacion' },
  { value: 'deal_onboarding', label: 'Onboarding' },
  { value: 'deal_ganado', label: 'Ganado' },
  { value: 'deal_perdido', label: 'Perdido' },
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewDealPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const venture = pickString(params.venture) ?? 'wobox_food';

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <p className="text-[12px] uppercase tracking-[0.1em] text-muted mb-1">CRM</p>
        <h1 className="text-3xl font-semibold tracking-tight">Nueva empresa</h1>
        <p className="text-muted mt-1.5 text-[13.5px]">
          Carga manual — equivalente a lo que antes se cargaba en HubSpot.
        </p>
      </div>

      <form action={createManualDeal} className="surface p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Empresa *" name="name" required />
          <SelectField
            label="Venture *"
            name="venture"
            defaultValue={venture}
            options={VENTURE_OPTIONS}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Rubro / categoria"
            name="subsector"
            placeholder="ej. Panaderia, Distribuidora"
          />
          <Field label="Instagram" name="instagram" placeholder="instagram.com/handle" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Ciudad *" name="region" placeholder="ej. Rosario, CABA" required />
          <Field label="Barrio" name="neighborhood" placeholder="ej. Palermo" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Sitio web" name="website" placeholder="ej. empresa.com" />
          <Field
            label="Valor estimado del deal"
            name="deal_value"
            type="number"
            placeholder="ARS"
          />
        </div>

        <SelectField
          label="Stage inicial"
          name="stage"
          defaultValue="deal_sin_contacto"
          options={STAGE_OPTIONS}
        />

        <div className="border-t border-[var(--border)] pt-5">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted mb-3">Contacto</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre *" name="contact_name" required />
            <Field label="Cargo" name="contact_role" placeholder="ej. Dueño, Gerente comercial" />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="Email *" name="contact_email" type="email" required />
            <Field label="Telefono *" name="contact_phone" required />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="bg-accent text-[var(--accent-foreground)] px-4 py-2 rounded-md text-[13.5px] font-medium hover:opacity-90 transition-opacity"
          >
            Crear empresa
          </button>
          <Link
            href={`/crm?venture=${venture}`}
            className="text-muted hover:text-[var(--foreground)] text-[13px]"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] text-muted mb-1.5">{label}</span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        required={required}
        className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-2 text-[13.5px] focus:outline-none focus:border-[var(--border-strong)]"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] text-muted mb-1.5">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-md px-3 py-2 text-[13.5px] focus:outline-none focus:border-[var(--border-strong)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
