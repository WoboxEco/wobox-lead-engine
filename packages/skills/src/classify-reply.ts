import { type DbClient, type Venture, createAdminClient, createLogger } from '@wobox/core';
import { claude } from '@wobox/integrations';
import { loadPrompt } from '@wobox/prompts';
import { z } from 'zod';

// Clasificacion barata y rapida: Haiku alcanza para leer una respuesta corta.
export const DEFAULT_MODEL = 'haiku';
const PROMPT_NAME = 'classify-reply-v1';
const DEFAULT_RESUME_DAYS = 7;

export const INTENTS = [
  'interested',
  'not_now',
  'not_interested',
  'question',
  'out_of_office',
  'other',
] as const;
export type ReplyIntent = (typeof INTENTS)[number];

export const SUGGESTED_ACTIONS = [
  'agendar_calendly',
  'responder_pregunta',
  'nurture_3_meses',
  'descartar',
  'reprogramar',
] as const;

const ClassificationSchema = z.object({
  intent: z.enum(INTENTS),
  suggested_action: z.enum(SUGGESTED_ACTIONS),
  reason: z.string().max(500),
  resume_in_days: z.number().int().min(1).max(60).nullable().optional(),
});
export type ReplyClassification = z.infer<typeof ClassificationSchema>;

const VENTURE_CONTEXT: Record<Venture, string> = {
  wobox_food:
    'Wobox Food: canal alternativo que vende el sobrestock de alimentos de las marcas a consumidores a precio reducido, sin canibalizar la marca.',
  wobox_fashion:
    'Wobox Fashion: canal alternativo que vende el sobrestock de moda, calzado y muebles/deco de las marcas a consumidores a precio reducido.',
  loop: 'Loop: tarjeta digital de fidelizacion eco via QR para negocios de cualquier tamano.',
};

export interface ClassifyReplyOptions {
  id?: string;
  /** Clasificar todas las replies sin intent. */
  pending?: boolean;
  limit?: string | number;
  model?: string;
}

type ReplyRow = {
  id: string;
  company_id: string;
  message_id: string | null;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
  companies: { venture: Venture; name: string } | null;
  messages: { subject: string | null; body: string } | null;
};

const REPLY_SELECT =
  'id, company_id, message_id, from_email, subject, body, received_at, companies(venture, name), messages(subject, body)';

export async function run(opts: ClassifyReplyOptions): Promise<void> {
  const db = createAdminClient();
  if (!opts.id && !opts.pending) {
    throw new Error('Requiere --id <reply_uuid> o --pending');
  }

  const ids: string[] = [];
  if (opts.id) {
    ids.push(opts.id);
  } else {
    const limit = Number(opts.limit ?? 20);
    const { data, error } = await db
      .from('replies')
      .select('id')
      .is('intent', null)
      .order('received_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    ids.push(...((data as unknown as Array<{ id: string }>) ?? []).map((r) => r.id));
  }

  if (ids.length === 0) {
    console.log('No hay replies pendientes de clasificar');
    return;
  }

  for (const id of ids) {
    try {
      const c = await classifyReply(db, id, opts.model ? { model: opts.model } : {});
      console.log(`[${id}] ${c.intent} -> ${c.suggested_action}: ${c.reason}`);
    } catch (err) {
      console.log(`[${id}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Clasifica una reply con Claude, guarda intent/suggested_action y aplica efectos:
 *   - not_interested -> company stage 'discarded'
 *   - out_of_office  -> despausa la secuencia y la reprograma (sequence_resume_at)
 * El resto queda en /inbox para que un founder decida.
 */
export async function classifyReply(
  db: DbClient,
  replyId: string,
  opts: { model?: string } = {},
): Promise<ReplyClassification> {
  const log = createLogger('classify-reply');
  const { data, error } = await db.from('replies').select(REPLY_SELECT).eq('id', replyId).single();
  if (error || !data) throw new Error(`reply ${replyId} no existe`);
  const reply = data as unknown as ReplyRow;
  const venture: Venture = reply.companies?.venture ?? 'wobox_food';

  const prompt = await loadPrompt('replies', PROMPT_NAME, {
    VENTURE_CONTEXT: VENTURE_CONTEXT[venture],
    ORIGINAL_SUBJECT: reply.messages?.subject || '(sin asunto)',
    ORIGINAL_BODY: reply.messages?.body || '(no encontramos el mensaje original)',
    RECEIVED_AT: reply.received_at,
    FROM: reply.from_email || '(desconocido)',
    REPLY_SUBJECT: reply.subject || '(sin asunto)',
    REPLY_BODY: (reply.body || '(vacio)').slice(0, 4000),
  });

  const result = await claude.completeJson({
    system:
      'Clasificas respuestas a emails de prospeccion B2B en Argentina. Respondes solo JSON valido.',
    user: prompt,
    schema: ClassificationSchema,
    venture,
    operation: 'classify-reply',
    model: opts.model ?? DEFAULT_MODEL,
    maxTokens: 300,
  });

  const now = new Date();
  const update: Record<string, unknown> = {
    intent: result.intent,
    suggested_action: result.suggested_action,
    ai_reasoning: result.reason,
    classified_at: now.toISOString(),
  };
  // OOO no necesita intervencion humana: se reprograma solo.
  if (result.intent === 'out_of_office') {
    update.handled = true;
    update.handled_at = now.toISOString();
  }
  const { error: updErr } = await db.from('replies').update(update).eq('id', replyId);
  if (updErr) throw new Error(`update reply: ${updErr.message}`);

  if (result.intent === 'not_interested') {
    await db
      .from('companies')
      .update({ stage: 'discarded', updated_at: now.toISOString() })
      .eq('id', reply.company_id);
  } else if (result.intent === 'out_of_office') {
    const days = result.resume_in_days ?? DEFAULT_RESUME_DAYS;
    const resumeAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    await db
      .from('companies')
      .update({
        sequence_paused: false,
        paused_reason: null,
        sequence_resume_at: resumeAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', reply.company_id);
  }

  log.info({ replyId, company: reply.companies?.name, intent: result.intent }, 'reply clasificada');
  return result;
}
