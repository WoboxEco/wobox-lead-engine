import { type DbClient, env } from '@wobox/core';
import { email } from '@wobox/integrations';

export interface DeliverableMessage {
  id: string;
  contact_id: string;
  channel: string;
  subject: string | null;
  body: string;
}

export interface DeliverResult {
  delivered: boolean;
  to?: string;
  messageId?: string;
}

/**
 * Envio real del mensaje. Hoy solo email (Google Workspace SMTP);
 * el resto de canales se mandan a mano y devuelven { delivered: false }.
 * `opts.to` fuerza el destinatario (si no, usa contacts.email).
 * Tira error si no se puede enviar, para que el caller NO marque el mensaje como sent.
 */
export async function deliverMessage(
  db: DbClient,
  msg: DeliverableMessage,
  opts: { to?: string } = {},
): Promise<DeliverResult> {
  if (msg.channel !== 'email') return { delivered: false };

  if (!email.isConfigured()) {
    throw new Error('Email no configurado: faltan GMAIL_USER / GMAIL_APP_PASSWORD');
  }

  // Si el caller pasa `to` explicito (lo que el founder ve en "Para:"), se usa ese.
  // Si no, se lee el email actual del contacto.
  let to = (opts.to ?? '').trim();
  if (!to) {
    const { data: contactData, error: contactErr } = await db
      .from('contacts')
      .select('email')
      .eq('id', msg.contact_id)
      .single();
    if (contactErr) throw new Error(`load contact: ${contactErr.message}`);
    to = ((contactData as { email: string | null } | null)?.email ?? '').trim();
  }
  if (!to) {
    throw new Error('El contacto no tiene email. Revelalo con 🔓 en /pipeline');
  }

  const limit = env().EMAIL_DAILY_LIMIT;
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const { count, error: countErr } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .eq('status', 'sent')
    .gte('sent_at', startOfDayUtc.toISOString());
  if (countErr) throw new Error(`count emails de hoy: ${countErr.message}`);
  if ((count ?? 0) >= limit) {
    throw new Error(`Limite diario de emails alcanzado (${count}/${limit}). Proba manana.`);
  }

  const res = await email.sendEmail({
    to,
    subject: msg.subject?.trim() || 'Wobox',
    text: msg.body,
  });
  return { delivered: true, to, messageId: res.messageId };
}
