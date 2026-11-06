import { env } from '@wobox/core';
import { ImapFlow, type MessageStructureObject } from 'imapflow';

export interface InboundEmail {
  /** Message-ID del header (o uid si falta) — se usa para dedup en `replies`. */
  externalId: string;
  uid: number;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  /** Texto plano (sin la cita del mensaje original cuando se puede detectar). */
  text: string;
  receivedAt: Date;
  inReplyTo: string | null;
}

export interface FetchUnseenOptions {
  /** Ventana hacia atras en dias (default 3). */
  sinceDays?: number;
  /** Max mensajes a leer (los mas nuevos primero). Default 50. */
  limit?: number;
  /**
   * Filtro previo por remitente: recibe todos los `from` (lowercase) de los no vistos y
   * devuelve cuales interesan. Solo se descarga el cuerpo de esos (ahorra tiempo en el cron).
   */
  filterFrom?: (fromEmails: string[]) => Promise<Set<string>>;
  /** Timeout de conexion/socket en ms (default 6000). */
  timeoutMs?: number;
}

/** true si hay credenciales (mismas que SMTP: GMAIL_USER + GMAIL_APP_PASSWORD). */
export function isConfigured(): boolean {
  const e = env();
  return Boolean(e.GMAIL_USER && e.GMAIL_APP_PASSWORD);
}

/**
 * Lee INBOX de imap.gmail.com y devuelve los mensajes NO vistos de los ultimos N dias.
 * No marca nada como leido (fetch usa BODY.PEEK): el founder los sigue viendo en Gmail.
 */
export async function fetchRecentUnseen(opts: FetchUnseenOptions = {}): Promise<InboundEmail[]> {
  const e = env();
  if (!e.GMAIL_USER || !e.GMAIL_APP_PASSWORD) {
    throw new Error('IMAP no configurado: faltan GMAIL_USER / GMAIL_APP_PASSWORD');
  }
  const sinceDays = opts.sinceDays ?? 3;
  const limit = opts.limit ?? 50;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const self = e.GMAIL_USER.toLowerCase();

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: e.GMAIL_USER, pass: e.GMAIL_APP_PASSWORD },
    logger: false,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs * 2,
  });

  await client.connect();
  const out: InboundEmail[] = [];
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const uids = (await client.search({ seen: false, since }, { uid: true })) as number[];
      if (uids.length === 0) return out;
      const recent = uids
        .map(Number)
        .sort((a, b) => b - a)
        .slice(0, limit);

      const metas = await client.fetchAll(
        recent,
        { uid: true, envelope: true, internalDate: true, bodyStructure: true },
        { uid: true },
      );

      const fromOf = (m: (typeof metas)[number]) =>
        (m.envelope?.from?.[0]?.address ?? '').trim().toLowerCase();
      const candidates = metas.filter((m) => {
        const f = fromOf(m);
        return f && f !== self;
      });
      const wanted = opts.filterFrom
        ? await opts.filterFrom([...new Set(candidates.map(fromOf))])
        : null;

      for (const m of candidates) {
        const from = m.envelope?.from?.[0];
        const fromEmail = fromOf(m);
        if (wanted && !wanted.has(fromEmail)) continue;

        const text = await downloadText(client, m.uid, m.bodyStructure);
        out.push({
          externalId: m.envelope?.messageId ?? `uid:${m.uid}`,
          uid: m.uid,
          fromEmail,
          fromName: from?.name || null,
          subject: m.envelope?.subject ?? null,
          text: stripQuoted(text),
          receivedAt: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()),
          inReplyTo: m.envelope?.inReplyTo ?? null,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return out;
}

/** Busca la primera parte text/plain (o text/html como fallback) y la baja decodificada. */
async function downloadText(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject | undefined,
): Promise<string> {
  const plain = findPart(structure, 'text/plain');
  const html = plain ? null : findPart(structure, 'text/html');
  const part = plain ?? html;
  if (!part) return '';

  const { content } = await client.download(String(uid), part, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of content as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return html ? htmlToText(raw) : raw;
}

function findPart(node: MessageStructureObject | undefined, type: string): string | null {
  if (!node) return null;
  if (node.type === type && node.disposition !== 'attachment') return node.part || '1';
  for (const child of node.childNodes ?? []) {
    const found = findPart(child, type);
    if (found) return found;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Corta la cita del mail original ("El lun, ... escribio:" / "On ... wrote:" / lineas con >). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^(El|On)\s.+(escribi[oó]|wrote):?$/i.test(l)) break;
    if (/^-{2,}\s*(Original Message|Mensaje original)/i.test(l)) break;
    if (/^De:\s|^From:\s/.test(l) && kept.length > 0) break;
    if (l.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}
