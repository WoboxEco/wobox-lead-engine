/**
 * Iconos-link de canales de contacto a nivel company (telefono, WhatsApp, IG, email
 * generico). Muestra "—" en los que faltan para que se vea de un vistazo que hay.
 */
export function ChannelLinks({
  phone,
  whatsapp,
  instagram,
  email,
}: {
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  email: string | null;
}) {
  const waDigits = whatsapp?.replace(/\D/g, '') ?? '';
  const igHandle = instagram?.replace(/^@/, '') ?? '';
  const items: Array<{ key: string; label: string; href: string | null; title: string }> = [
    {
      key: 'tel',
      label: '📞',
      href: phone ? `tel:${phone}` : null,
      title: phone ?? 'Sin teléfono',
    },
    {
      key: 'wa',
      label: 'WA',
      href: waDigits ? `https://wa.me/${waDigits}` : null,
      title: whatsapp ? `WhatsApp ${whatsapp}` : 'Sin WhatsApp',
    },
    {
      key: 'ig',
      label: 'IG',
      href: igHandle ? `https://instagram.com/${igHandle}` : null,
      title: igHandle ? `@${igHandle}` : 'Sin Instagram',
    },
    {
      key: 'mail',
      label: '✉️',
      href: email ? `mailto:${email}` : null,
      title: email ?? 'Sin email genérico',
    },
  ];

  return (
    <div className="flex items-center gap-1.5 text-[11.5px]">
      {items.map((it) =>
        it.href ? (
          <a
            key={it.key}
            href={it.href}
            title={it.title}
            target={it.key === 'tel' || it.key === 'mail' ? undefined : '_blank'}
            rel="noreferrer"
            className="px-1.5 py-0.5 rounded border border-[var(--border)] text-accent hover:border-accent transition-colors"
          >
            {it.label}
          </a>
        ) : (
          <span key={it.key} title={it.title} className="px-1.5 py-0.5 text-muted opacity-50">
            {it.label} —
          </span>
        ),
      )}
    </div>
  );
}
