import { type DbClient, createAdminClient, createLogger, writeErrorLog } from '@wobox/core';
import { imap } from '@wobox/integrations';

import { classifyReply } from './classify-reply.js';

export interface CheckRepliesOptions {
  /** Ventana IMAP en dias (default 3). */
  sinceDays?: string | number;
  /** No clasificar con Claude (queda intent=null; luego `classify-reply --pending`). */
  noClassify?: boolean;
  dryRun?: boolean;
  /** Corte por tiempo (cron). Se consulta antes de clasificar cada reply. */
  canContinue?: () => boolean;
}

export interface CheckRepliesResult {
  configured: boolean;
  fetched: number;
  matched: number;
  inserted: number;
  duplicates: number;
  classified: number;
  cutShort: boolean;
  replyIds: string[];
}

type ContactRow = { id: string; email: string; company_id: string };

export async function run(opts: CheckRepliesOptions = {}): Promise<CheckRepliesResult> {
  return checkReplies(createAdminClient(), opts);
}

/**
 * Lee no vistos de INBOX (ultimos N dias), matchea `from` con contacts.email y por cada match:
 *   1. inserta en `replies` (dedup por Message-ID)
 *   2. crea interaction outcome='replied'
 *   3. pausa la secuencia del company (sequence_paused=true, paused_reason='replied')
 *   4. clasifica con classify-reply (si queda tiempo)
 */
export async function checkReplies(
  db: DbClient,
  opts: CheckRepliesOptions = {},
): Promise<CheckRepliesResult> {
  const log = createLogger('check-replies');
  const result: CheckRepliesResult = {
    configured: imap.isConfigured(),
    fetched: 0,
    matched: 0,
    inserted: 0,
    duplicates: 0,
    classified: 0,
    cutShort: false,
    replyIds: [],
  };
  if (!result.configured) {
    console.log('IMAP no configurado (GMAIL_USER / GMAIL_APP_PASSWORD), skip');
    return result;
  }

  const contactsByEmail = new Map<string, ContactRow[]>();
  const emails = await imap.fetchRecentUnseen({
    sinceDays: Number(opts.sinceDays ?? 3),
    filterFrom: async (froms) => {
      if (froms.length === 0) return new Set();
      const { data, error } = await db
        .from('contacts')
        .select('id, email, company_id')
        .in('email', froms);
      if (error) throw new Error(`load contacts: ${error.message}`);
      for (const c of (data as unknown as ContactRow[]) ?? []) {
        const key = c.email.trim().toLowerCase();
        contactsByEmail.set(key, [...(contactsByEmail.get(key) ?? []), c]);
      }
      return new Set(contactsByEmail.keys());
    },
  });
  result.fetched = emails.length;
  result.matched = emails.length;

  if (emails.length === 0) {
    console.log('Sin respuestas nuevas de contactos');
    return result;
  }

  const { data: existing, error: exErr } = await db
    .from('replies')
    .select('external_id')
    .in(
      'external_id',
      emails.map((e) => e.externalId),
    );
  if (exErr) throw new Error(`load replies: ${exErr.message}`);
  const seen = new Set(
    ((existing as unknown as Array<{ external_id: string }>) ?? []).map((r) => r.external_id),
  );

  for (const mail of emails) {
    if (seen.has(mail.externalId)) {
      result.duplicates++;
      continue;
    }
    const candidates = contactsByEmail.get(mail.fromEmail) ?? [];
    if (candidates.length === 0) continue;

    if (opts.dryRun) {
      console.log(`[DRY-RUN] reply de ${mail.fromEmail}: ${mail.subject ?? '(sin asunto)'}`);
      continue;
    }

    try {
      const replyId = await recordReply(db, mail, candidates);
      seen.add(mail.externalId);
      result.inserted++;
      result.replyIds.push(replyId);
      console.log(`[reply] ${mail.fromEmail}: ${mail.subject ?? '(sin asunto)'}`);
    } catch (err) {
      log.error({ err: String(err), from: mail.fromEmail }, 'no se pudo registrar reply');
      await writeErrorLog(db, {
        skill: 'check-replies',
        error: err,
        context: { from: mail.fromEmail, externalId: mail.externalId },
      });
    }
  }

  if (!opts.noClassify && !opts.dryRun) {
    for (const id of result.replyIds) {
      if (opts.canContinue && !opts.canContinue()) {
        result.cutShort = true;
        break;
      }
      try {
        await classifyReply(db, id);
        result.classified++;
      } catch (err) {
        log.warn({ err: String(err), replyId: id }, 'clasificacion fallo (queda pendiente)');
      }
    }
  }

  console.log(
    `check-replies: fetched=${result.fetched} inserted=${result.inserted} duplicates=${result.duplicates} classified=${result.classified}`,
  );
  return result;
}

async function recordReply(
  db: DbClient,
  mail: imap.InboundEmail,
  candidates: ContactRow[],
): Promise<string> {
  // Si el mismo email esta en varias companies (ventures distintas), nos quedamos con el
  // contacto al que le escribimos mas recientemente.
  const { data: lastMsgs } = await db
    .from('messages')
    .select('id, contact_id, company_id, sent_at')
    .in(
      'contact_id',
      candidates.map((c) => c.id),
    )
    .eq('status', 'sent')
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(1);
  const lastMsg = ((lastMsgs as unknown as Array<{
    id: string;
    contact_id: string;
    company_id: string;
  }>) ?? [])[0];
  const contact = candidates.find((c) => c.id === lastMsg?.contact_id) ?? candidates[0]!;
  const receivedAt = mail.receivedAt.toISOString();

  const { data: inserted, error: insErr } = await db
    .from('replies')
    .insert({
      company_id: contact.company_id,
      contact_id: contact.id,
      message_id: lastMsg?.id ?? null,
      channel: 'email',
      external_id: mail.externalId,
      from_email: mail.fromEmail,
      subject: mail.subject,
      body: mail.text,
      received_at: receivedAt,
    })
    .select('id')
    .single();
  if (insErr || !inserted) throw new Error(`insert reply: ${insErr?.message}`);

  const { error: intErr } = await db.from('interactions').insert({
    contact_id: contact.id,
    company_id: contact.company_id,
    type: 'email',
    channel: 'email',
    content: mail.text,
    ai_generated: false,
    outcome: 'replied',
    performed_at: receivedAt,
  });
  if (intErr) throw new Error(`insert interaction: ${intErr.message}`);

  const { error: pauseErr } = await db
    .from('companies')
    .update({
      sequence_paused: true,
      paused_reason: 'replied',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.company_id);
  if (pauseErr) throw new Error(`pause company: ${pauseErr.message}`);

  return (inserted as unknown as { id: string }).id;
}
