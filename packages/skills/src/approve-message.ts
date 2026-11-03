import { type DbClient, createAdminClient, createLogger } from '@wobox/core';
import { sendMessage } from './deliver.js';

export interface ApproveMessageOptions {
  id?: string;
  action?: 'approve' | 'edit' | 'send' | 'discard';
  body?: string;
  subject?: string;
  venture?: string;
}

type MessageRow = Record<string, unknown> & {
  id: string;
  company_id: string;
  contact_id: string;
  approach_type: 'warm_intro' | 'nurture' | 'direct';
  channel: string;
  sequence_step: number | null;
  subject: string | null;
  body: string;
  original_body: string;
  prompt_version: string;
  status: 'draft' | 'approved' | 'sent' | 'discarded';
};

type CompanyShort = { id: string; name: string; venture: string; stage: string };

export async function run(opts: ApproveMessageOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('approve-message');

  if (!opts.id) {
    await listDrafts(db, opts.venture);
    return;
  }

  const action = opts.action;
  if (!action) {
    throw new Error('Requiere --action approve | edit | send | discard');
  }

  const { data: msgData, error: fetchErr } = await db
    .from('messages')
    .select('*')
    .eq('id', opts.id)
    .single();
  if (fetchErr || !msgData) {
    throw new Error(`Message ${opts.id} no existe: ${fetchErr?.message ?? 'not found'}`);
  }
  const msg = msgData as MessageRow;

  switch (action) {
    case 'approve':
      await doApprove(db, msg, log);
      break;
    case 'edit':
      if (!opts.body) throw new Error('--action=edit requiere --body "<texto nuevo>"');
      await doEdit(db, msg, opts.body, opts.subject, log);
      break;
    case 'send':
      await doSend(db, msg, log);
      break;
    case 'discard':
      await doDiscard(db, msg, log);
      break;
    default:
      throw new Error(`action invalida: ${action}`);
  }
}

async function listDrafts(db: DbClient, venture: string | undefined): Promise<void> {
  const log = createLogger('approve-message');

  let query = db
    .from('messages')
    .select('*, companies!inner(name, venture, stage)')
    .eq('status', 'draft');
  if (venture) {
    query = query.eq('companies.venture', venture);
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);

  const rows = (data as unknown as Array<MessageRow & { companies: CompanyShort }>) ?? [];
  if (rows.length === 0) {
    log.info('no hay mensajes en status=draft');
    return;
  }

  console.log(`\n${rows.length} drafts pendientes:\n`);
  for (const r of rows) {
    const c = r.companies;
    const edited = r.body !== r.original_body ? ' (editado)' : '';
    const step = r.sequence_step ? ` step=${r.sequence_step}` : '';
    console.log(`[${r.id}]`);
    console.log(`  ${c.name} (${c.venture}) | ${r.approach_type} | ${r.channel}${step}${edited}`);
    if (r.subject) console.log(`  SUBJECT: ${r.subject}`);
    console.log(`  ${r.body.replace(/\n/g, ' ').slice(0, 140)}${r.body.length > 140 ? '...' : ''}`);
    console.log();
  }
  console.log('Siguientes:');
  console.log('  pnpm skill approve-message --id=<uuid> --action=approve');
  console.log('  pnpm skill approve-message --id=<uuid> --action=edit --body="..."');
  console.log('  pnpm skill approve-message --id=<uuid> --action=send');
  console.log('  pnpm skill approve-message --id=<uuid> --action=discard');
}

async function doApprove(
  db: DbClient,
  msg: MessageRow,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  assertStatus(msg, ['draft']);
  const { error } = await db.from('messages').update({ status: 'approved' }).eq('id', msg.id);
  if (error) throw new Error(error.message);
  log.info({ id: msg.id }, 'mensaje aprobado');
}

async function doEdit(
  db: DbClient,
  msg: MessageRow,
  newBody: string,
  newSubject: string | undefined,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  assertStatus(msg, ['draft', 'approved']);
  const update: Record<string, unknown> = { body: newBody, status: 'approved' };
  if (newSubject !== undefined) update.subject = newSubject;
  const { error } = await db.from('messages').update(update).eq('id', msg.id);
  if (error) throw new Error(error.message);
  log.info(
    {
      id: msg.id,
      body_delta_chars: Math.abs(newBody.length - msg.original_body.length),
      edited: true,
    },
    'mensaje editado y aprobado',
  );
}

async function doSend(
  db: DbClient,
  msg: MessageRow,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  assertStatus(msg, ['draft', 'approved']);

  // Envio real (email via SMTP) + marcado sent + interaction + stage. Si falla, tira.
  const res = await sendMessage(db, msg);
  if (res.delivered) {
    log.info({ id: msg.id, to: res.to, messageId: res.messageId }, 'email enviado');
  }
  log.info({ id: msg.id, nextStage: res.nextStage }, 'mensaje enviado');
}

async function doDiscard(
  db: DbClient,
  msg: MessageRow,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const { error } = await db.from('messages').update({ status: 'discarded' }).eq('id', msg.id);
  if (error) throw new Error(error.message);
  log.info({ id: msg.id }, 'mensaje descartado');
}

function assertStatus(msg: MessageRow, allowed: MessageRow['status'][]): void {
  if (!allowed.includes(msg.status)) {
    throw new Error(`mensaje en status=${msg.status}, no se puede aplicar esta accion`);
  }
}
