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
 * `opts.to` fuerza el destinatario (si no, usa contacts.email o companies.generic_email).
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
  // Si no, se lee el email actual del contacto y, si falta, el email genérico de la company.
  let to = (opts.to ?? '').trim();
  if (!to) {
    const { data: contactData, error: contactErr } = await db
      .from('contacts')
      .select('email, companies(generic_email)')
      .eq('id', msg.contact_id)
      .single();
    if (contactErr) throw new Error(`load contact: ${contactErr.message}`);
    to =
      resolveEmailRecipient(
        contactData as unknown as {
          email: string | null;
          companies: { generic_email: string | null } | null;
        } | null,
      ) ?? '';
  }
  if (!to) {
    throw new Error(
      'El contacto no tiene email ni la company email genérico. Revelalo con 🔓 o corré "Enriquecer contactos" en /pipeline',
    );
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

/** Email del decision-maker; si no tiene, el email generico de la company (info@, ventas@...). */
export function resolveEmailRecipient(
  row: { email: string | null; companies: { generic_email: string | null } | null } | null,
): string | null {
  const personal = row?.email?.trim();
  if (personal) return personal;
  const generic = row?.companies?.generic_email?.trim();
  return generic || null;
}

export interface SendableMessage extends DeliverableMessage {
  company_id: string;
  approach_type: string;
  original_body: string;
  status: string;
}

export interface SendResult extends DeliverResult {
  sentAt: string;
  nextStage: string;
  stageChanged: boolean;
}

const STAGE_ORDER = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
];

export function isStageDowngrade(current: string, next: string): boolean {
  const ci = STAGE_ORDER.indexOf(current);
  const ni = STAGE_ORDER.indexOf(next);
  if (ci < 0 || ni < 0) return false;
  return ni < ci;
}

/**
 * Envia un mensaje (draft|approved) y registra todo lo que implica:
 *   1. deliverMessage (email real via SMTP; otros canales son manuales)
 *   2. messages.status=sent + sent_at + sent_to
 *   3. interaction outcome=sent
 *   4. stage: nurture -> 'nurturing', direct/warm_intro -> 'contacted' (sin downgrade)
 * Compartido por approve-message (CLI), /drafts (dashboard) y el cron de auto_send.
 * Si deliverMessage falla, tira y el mensaje NO se marca como sent.
 * `opts.to` fuerza el destinatario del email (lo que el founder confirmó en "Para:").
 */
export async function sendMessage(
  db: DbClient,
  msg: SendableMessage,
  opts: { to?: string } = {},
): Promise<SendResult> {
  if (!['draft', 'approved'].includes(msg.status)) {
    throw new Error(`mensaje en status=${msg.status}, no se puede enviar`);
  }

  const delivery = await deliverMessage(db, msg, opts.to ? { to: opts.to } : {});
  const sentTo = delivery.to ?? opts.to ?? null;
  const now = new Date().toISOString();

  let { error: msgErr } = await db
    .from('messages')
    .update({ status: 'sent', sent_at: now, sent_to: sentTo })
    .eq('id', msg.id);
  if (isMissingSentToColumn(msgErr)) {
    // Migration 0009_messages_sent_to sin aplicar: no perder el estado sent (el mail ya salió).
    // El destinatario queda igual en interactions.metadata.sent_to.
    ({ error: msgErr } = await db
      .from('messages')
      .update({ status: 'sent', sent_at: now })
      .eq('id', msg.id));
  }
  if (msgErr) throw new Error(`update message: ${msgErr.message}`);

  const { error: intErr } = await db.from('interactions').insert({
    contact_id: msg.contact_id,
    company_id: msg.company_id,
    type: msg.channel === 'email' ? 'email' : 'message',
    channel: msg.channel,
    content: msg.body,
    ai_generated: msg.body === msg.original_body,
    outcome: 'sent',
    performed_at: now,
    metadata: { message_id: msg.id, sent_to: sentTo },
  });
  if (intErr) throw new Error(`insert interaction: ${intErr.message}`);

  const nextStage = msg.approach_type === 'nurture' ? 'nurturing' : 'contacted';
  const { data: companyData } = await db
    .from('companies')
    .select('stage')
    .eq('id', msg.company_id)
    .single();
  const currentStage = (companyData as { stage: string } | null)?.stage;

  let stageChanged = false;
  if (currentStage && currentStage !== nextStage && !isStageDowngrade(currentStage, nextStage)) {
    const { error: stageErr } = await db
      .from('companies')
      .update({ stage: nextStage, updated_at: now })
      .eq('id', msg.company_id);
    stageChanged = !stageErr;
  }

  return { ...delivery, sentAt: now, nextStage, stageChanged };
}

/** true si el error de PostgREST es porque la columna messages.sent_to no existe (migration 0009 sin aplicar). */
export function isMissingSentToColumn(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST204' || err.code === '42703' || /sent_to/.test(err.message ?? '');
}
