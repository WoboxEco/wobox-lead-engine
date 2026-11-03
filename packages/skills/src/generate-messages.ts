import {
  type ApproachType,
  type Channel,
  type DbClient,
  type Venture,
  createAdminClient,
  createLogger,
  writeErrorLog,
} from '@wobox/core';
import { claude } from '@wobox/integrations';
import { loadPrompt } from '@wobox/prompts';
import { hasEmail, selectContact } from './contact-selection.js';
import { type GenerateFailure, formatFailures } from './summary.js';

export { formatFailures };
export type { GenerateFailure };

// Default: Sonnet. La generacion de mensajes depende de voz argentina + creatividad
// + adaptacion por BP/canal. Override con --model=haiku solo para pruebas de volumen.
export const DEFAULT_MODEL = 'sonnet';

export interface GenerateMessagesOptions {
  id?: string;
  /** Batch: genera para todas las companies de un stage/venture en vez de --id */
  all?: boolean;
  venture?: string;
  /** Stage objetivo en modo batch (default: qualified) */
  stage?: string;
  /** Max companies en modo batch (default: 50) */
  limit?: string;
  /** Regenerar aunque ya exista un draft para el canal. Al generar el nuevo,
   *  descarta (status=discarded) los drafts pendientes previos de esa company + canal. */
  force?: boolean;
  contactId?: string;
  approach?: ApproachType;
  channel?: Channel;
  step?: string;
  model?: string;
  /** Con channel=email: saltea (no genera draft) a los contactos sin email. */
  requireEmail?: boolean;
  /** Batch: restringe a estas companies (el dashboard procesa de a 2-3 por request). */
  ids?: string[];
  /** Batch: no genera nada, solo devuelve en `pending` las companies a generar. */
  planOnly?: boolean;
}

export interface GenerateMessagesResult {
  ok: number;
  skipped: number;
  failed: number;
  /** Subconjunto de skipped: ningún contacto de la company tiene email (requireEmail + channel=email) */
  noEmail: number;
  /** Subconjunto de skipped: company sin contactos */
  noContacts: number;
  /** Detalle de cada fallo (también queda en error_logs). */
  failures: GenerateFailure[];
  /** Con planOnly: IDs de las companies que se generarían. */
  pending?: string[];
}

function emptyResult(): GenerateMessagesResult {
  return { ok: 0, skipped: 0, failed: 0, noEmail: 0, noContacts: 0, failures: [] };
}

/** Motivo legible y agrupable de un fallo de generación. */
export function failureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').trim().slice(0, 200) || 'error desconocido';
}

const COMPANY_SELECT =
  '*, contacts(*), scores(total_score, scoring_model, ai_reasoning, scored_at)';

type CompanyRow = Record<string, unknown> & {
  id: string;
  name: string;
  venture: Venture;
  vertical?: string;
  subsector?: string;
  buyer_persona?: string;
  locations_count?: number;
  region?: string;
  neighborhood?: string;
  social_followers?: number;
  instagram_handle?: string;
  phone?: string | null;
  whatsapp?: string | null;
  generic_email?: string | null;
  linkedin_url?: string | null;
  contacts: Contact[];
  scores: Array<{
    total_score: number;
    scoring_model: string;
    ai_reasoning: string;
    scored_at: string;
  }>;
};

export async function run(opts: GenerateMessagesOptions): Promise<GenerateMessagesResult> {
  const log = createLogger('generate-messages');
  const db = createAdminClient();

  const model = opts.model ?? DEFAULT_MODEL;
  const channel: Channel = opts.channel ?? 'linkedin';
  const step = Number.parseInt(opts.step ?? '1', 10);
  const requireEmail = opts.requireEmail === true && channel === 'email';

  if (!opts.id && !opts.all) {
    throw new Error(
      'Requiere --id <company_uuid> o --all (opcional con --venture, --stage, --limit)',
    );
  }

  // Modo single
  if (opts.id) {
    const company = await fetchCompany(db, opts.id);
    if (!company) throw new Error(`Company ${opts.id} not found`);
    if (requireEmail && !hasEmail(pickContact(company, channel, opts.contactId))) {
      console.log(`  [skip] ${company.name}: ningún contacto con email`);
      return { ...emptyResult(), skipped: 1, noEmail: 1 };
    }
    const ctx: GenerateContext = { channel, step };
    try {
      const previous = opts.force ? await pendingDraftIds(db, company.id, channel) : [];
      const newId = await generateForCompany({ db, log, company, model, channel, step, opts, ctx });
      await discardDrafts(db, previous, newId);
    } catch (err) {
      await logFailure(db, company, err, { ...ctx, venture: company.venture, model });
      throw err;
    }
    console.log(`Draft generado para ${company.name}`);
    return { ...emptyResult(), ok: 1 };
  }

  // Modo batch
  const stage = opts.stage ?? 'qualified';
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 50;
  let q = db.from('companies').select(COMPANY_SELECT).eq('stage', stage).limit(limit);
  if (opts.venture) q = q.eq('venture', opts.venture);
  if (opts.ids) {
    if (opts.ids.length === 0) return emptyResult();
    q = q.in('id', opts.ids);
  }
  const { data, error } = await q;
  if (error) throw new Error(`fetch companies: ${error.message}`);
  const companies = (data as unknown as CompanyRow[]) ?? [];

  if (companies.length === 0) {
    console.log(
      `No hay companies en stage=${stage}${opts.venture ? ` venture=${opts.venture}` : ''}.`,
    );
    return emptyResult();
  }

  // Pre-cargar drafts existentes del canal para no duplicar (salvo --force).
  const haveDraft = new Set<string>();
  if (!opts.force) {
    const ids = companies.map((c) => c.id);
    const { data: msgs } = await db
      .from('messages')
      .select('company_id')
      .eq('channel', channel)
      .eq('status', 'draft')
      .in('company_id', ids);
    for (const m of (msgs as Array<{ company_id: string }> | null) ?? []) {
      haveDraft.add(m.company_id);
    }
  }

  console.log(
    `\nGenerando mensajes (canal=${channel}, modelo=${model}) para ${companies.length} companies en stage=${stage}...\n`,
  );

  const result = emptyResult();
  const pending: CompanyRow[] = [];

  for (const company of companies) {
    if (!company.contacts || company.contacts.length === 0) {
      result.skipped++;
      result.noContacts++;
      console.log(`  [skip] ${company.name}: sin contacts`);
      continue;
    }
    if (haveDraft.has(company.id)) {
      result.skipped++;
      console.log(`  [skip] ${company.name}: ya tiene draft ${channel} (--force para regenerar)`);
      continue;
    }
    if (requireEmail && !hasEmail(pickContact(company, channel, opts.contactId))) {
      result.skipped++;
      result.noEmail++;
      console.log(`  [skip] ${company.name}: ningún contacto con email`);
      continue;
    }
    pending.push(company);
  }

  if (opts.planOnly) {
    result.pending = pending.map((c) => c.id);
    return result;
  }

  for (const company of pending) {
    const ctx: GenerateContext = { batch: true, channel, step };
    try {
      const previous = opts.force ? await pendingDraftIds(db, company.id, channel) : [];
      const newId = await generateForCompany({ db, log, company, model, channel, step, opts, ctx });
      // Recién con el draft nuevo guardado descartamos los anteriores (si falla, no se pierde nada).
      const discarded = await discardDrafts(db, previous, newId);
      result.ok++;
      if (discarded > 0)
        console.log(`  [ok]   ${company.name} (descartados ${discarded} drafts previos)`);
      else console.log(`  [ok]   ${company.name}`);
    } catch (err) {
      result.failed++;
      const reason = failureReason(err);
      result.failures.push({ companyId: company.id, company: company.name, reason });
      console.log(`  [FAIL] ${company.name}: ${reason}`);
      await logFailure(db, company, err, { ...ctx, venture: company.venture, model });
    }
  }

  console.log(
    `\ngenerate-messages done: ok=${result.ok} skipped=${result.skipped} failed=${result.failed}${requireEmail ? ` sin_email=${result.noEmail}` : ''}`,
  );
  if (result.failures.length > 0) console.log(formatFailures(result.failures));
  return result;
}

/** Contexto que se va completando durante la generación, para error_logs. */
type GenerateContext = {
  batch?: boolean;
  channel: Channel;
  step: number;
  approach?: ApproachType;
  promptName?: string;
  contactId?: string;
  stage?: 'contact' | 'prompt' | 'claude' | 'insert';
};

async function logFailure(
  db: DbClient,
  company: CompanyRow,
  err: unknown,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await writeErrorLog(db, {
      skill: 'generate-messages',
      error: err,
      companyId: company.id,
      context: { ...context, company: company.name },
    });
  } catch (logErr) {
    console.warn(`[generate-messages] no se pudo escribir error_logs: ${String(logErr)}`);
  }
}

/** IDs de drafts pendientes (status=draft) de una company para un canal. */
async function pendingDraftIds(
  db: DbClient,
  companyId: string,
  channel: Channel,
): Promise<string[]> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .eq('status', 'draft');
  if (error) throw new Error(`fetch drafts previos: ${error.message}`);
  return ((data as Array<{ id: string }> | null) ?? []).map((m) => m.id);
}

/** Descarta los drafts indicados (salvo el recién creado). Devuelve cuántos descartó. */
async function discardDrafts(db: DbClient, ids: string[], keepId: string): Promise<number> {
  const toDiscard = ids.filter((id) => id !== keepId);
  if (toDiscard.length === 0) return 0;
  const { error } = await db
    .from('messages')
    .update({ status: 'discarded' })
    .in('id', toDiscard)
    .eq('status', 'draft');
  if (error) throw new Error(`descartar drafts previos: ${error.message}`);
  return toDiscard.length;
}

async function fetchCompany(db: DbClient, id: string): Promise<CompanyRow | null> {
  const { data, error } = await db.from('companies').select(COMPANY_SELECT).eq('id', id).single();
  if (error || !data) return null;
  return data as unknown as CompanyRow;
}

async function generateForCompany(args: {
  db: DbClient;
  log: ReturnType<typeof createLogger>;
  company: CompanyRow;
  model: string;
  channel: Channel;
  step: number;
  opts: GenerateMessagesOptions;
  /** Se completa a medida que avanza (approach, prompt, etapa) para loguear fallos. */
  ctx?: GenerateContext;
}): Promise<string> {
  const { db, log, company, model, channel, opts } = args;
  const ctx: Partial<GenerateContext> = args.ctx ?? {};
  ctx.stage = 'contact';

  // Email: el contacto con email (DM con email > cualquiera con email) para que el draft
  // quede con un contact_id que /drafts pueda mostrar en "Para:" y enviar.
  const contact = pickContact(company, channel, opts.contactId);
  if (!contact) {
    throw new Error('sin contacts (insertar uno, idealmente con is_decision_maker=true)');
  }
  ctx.contactId = contact.id;

  const latestScore = company.scores
    .slice()
    .sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];

  const { approach, step } = resolveApproachAndStep({
    contact,
    totalScore: latestScore?.total_score,
    channel,
    step: args.step,
    ...(opts.approach ? { approach: opts.approach } : {}),
  });
  const promptName =
    channel === 'email' && approach === 'nurture' && step > EMAIL_NURTURE_FIRST_STEP
      ? 'message-email-followup-v1'
      : selectPromptName(company.venture, company.vertical, approach);
  const vars = buildVars({
    company,
    contact,
    channel,
    step,
    ...(latestScore ? { score: latestScore } : {}),
  });

  ctx.approach = approach;
  ctx.step = step;
  ctx.promptName = promptName;

  const target = resolveChannelTarget(company, contact, channel);
  vars.CHANNEL_TARGET = target ? target.value : 'sin dato';
  if (!target) {
    log.warn(
      { company: company.name, channel },
      'sin dato de contacto para el canal (enriquecer contactos en /pipeline)',
    );
  }

  log.info(
    { model, approach, channel, step, promptName, company: company.name, target: target?.source },
    'generating message',
  );

  ctx.stage = 'prompt';
  const prompt = await loadPrompt('messages', promptName, vars);
  ctx.stage = 'claude';
  const system = buildSystemPrompt(
    company.venture,
    approach,
    channel,
    step,
    target?.generic === true,
  );
  const rawOutput = await claude.completeText({
    system,
    user: prompt,
    venture: company.venture,
    operation: `generate-${promptName}`,
    model,
    maxTokens: 1024,
  });

  const { subject, body } = parseOutput(rawOutput, channel);
  if (!body.trim()) throw new Error('Claude devolvió un mensaje vacío');

  ctx.stage = 'insert';

  const { data: inserted, error: insertErr } = await db
    .from('messages')
    .insert({
      contact_id: contact.id,
      company_id: company.id,
      sequence_step: approach === 'nurture' ? step : null,
      approach_type: approach,
      channel,
      subject,
      body,
      original_body: body,
      prompt_version: promptName,
      status: 'draft',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    throw new Error(`insert message: ${insertErr?.message ?? 'sin id'}`);
  }

  log.info({ promptName, approach, channel, step, company: company.name }, 'draft message saved');
  return (inserted as { id: string }).id;
}

export type Contact = Record<string, unknown> & {
  id: string;
  name: string;
  role?: string;
  email?: string | null;
  phone?: string;
  linkedin_url?: string;
  instagram_url?: string;
  warm_path?: 'direct' | '2nd_degree' | 'none';
  warm_connector?: string;
  is_decision_maker?: boolean;
};

function pickContact(company: CompanyRow, channel: Channel, preferId?: string): Contact | null {
  return selectContact(company.contacts, { channel, preferId });
}

/**
 * Por email el nurture arranca en el step 4 (propuesta): los steps 1-3 son
 * comentarios de valor pensados para posts de LinkedIn / Instagram y no tienen
 * sentido como email en frío. Los steps > 4 por email son follow-ups cortos.
 */
export const EMAIL_NURTURE_FIRST_STEP = 4;
/** Último step de la secuencia por email (4 = propuesta, 5-6 = follow-ups). */
export const EMAIL_NURTURE_LAST_STEP = 6;

export function resolveApproachAndStep(args: {
  contact: Contact;
  totalScore: number | undefined;
  channel: Channel;
  step: number;
  approach?: ApproachType;
}): { approach: ApproachType; step: number } {
  const { contact, totalScore, channel } = args;
  const step = Number.isFinite(args.step) && args.step > 0 ? args.step : 1;
  if (channel !== 'email') {
    return { approach: args.approach ?? selectApproach(contact, totalScore), step };
  }
  // Email: primer contacto = warm_intro si hay warm path, si no direct. Nunca nurture 1-3.
  const approach: ApproachType = args.approach ?? (hasWarmPath(contact) ? 'warm_intro' : 'direct');
  if (approach !== 'nurture') return { approach, step };
  return { approach, step: Math.max(step, EMAIL_NURTURE_FIRST_STEP) };
}

function hasWarmPath(contact: Contact): boolean {
  return contact.warm_path === 'direct' || contact.warm_path === '2nd_degree';
}

export function selectApproach(contact: Contact, totalScore: number | undefined): ApproachType {
  if (hasWarmPath(contact)) return 'warm_intro';
  if ((totalScore ?? 0) >= 80) return 'direct';
  return 'nurture';
}

function selectPromptName(
  venture: Venture,
  vertical: string | undefined,
  approach: ApproachType,
): string {
  if (venture === 'loop') {
    return `message-loop-${approach.replace('_', '-')}-v1`;
  }
  // Wobox: food usa el warm_intro compartido; fashion tiene el suyo (propuesta
  // de Flash Sales / Outlet Digital). Nurture y direct se bifurcan por vertical.
  if (approach === 'warm_intro') {
    return venture === 'wobox_fashion'
      ? 'message-wobox-warm-intro-fashion-v1'
      : 'message-wobox-warm-intro-v1';
  }
  const verticalSlug = venture === 'wobox_food' ? 'food' : 'fashion';
  return `message-wobox-${approach}-${verticalSlug}-v1`;
}

function buildVars(args: {
  company: {
    name: string;
    venture: Venture;
    vertical?: string;
    subsector?: string;
    buyer_persona?: string;
    locations_count?: number;
    region?: string;
    neighborhood?: string;
    social_followers?: number;
    instagram_handle?: string;
  };
  contact: Contact;
  score?: { total_score: number; ai_reasoning: string };
  channel: Channel;
  step: number;
}): Record<string, string> {
  const { company, contact, score, channel, step } = args;
  const ig = company.instagram_handle ? `@${company.instagram_handle}` : 'sin IG';
  const followers = company.social_followers ? `${company.social_followers} followers IG` : '';
  const locations = company.locations_count ?? 1;
  const regionLabel =
    [company.neighborhood, company.region].filter(Boolean).join(', ') || 'Argentina';

  const insightParts = [
    `${locations} local${locations !== 1 ? 'es' : ''}`,
    regionLabel,
    company.subsector ?? company.vertical ?? '',
    followers,
  ].filter(Boolean);
  const profileInsight = insightParts.join(' | ');

  return {
    COMPANY_NAME: company.name,
    PRODUCT: PRODUCT_LABELS[company.venture] ?? 'Wobox',
    CONTACT_NAME: contact.name,
    CONTACT_ROLE: contact.role ?? 'decision maker',
    VERTICAL: company.vertical ?? company.subsector ?? 'retail',
    SUBSECTOR: company.subsector ?? company.vertical ?? 'retail',
    LOCATIONS_COUNT: String(locations),
    REGION: regionLabel,
    BUYER_PERSONA: company.buyer_persona ?? 'BP1',
    SOCIAL_PROFILE: ig,
    PROFILE_INSIGHT: profileInsight || 'n/a',
    CHANNEL: channel,
    STEP_NUMBER: String(step),
    TOTAL_SCORE: score ? String(score.total_score) : 'n/a',
    AI_REASONING: score?.ai_reasoning ?? 'n/a',
    CONNECTOR_NAME: contact.warm_connector ?? 'n/a',
    WARM_CONNECTOR: contact.warm_connector ?? 'n/a',
    TODAY: todayInBuenosAires(),
  };
}

const PRODUCT_LABELS: Record<Venture, string> = {
  loop: 'Loop',
  wobox_food: 'Wobox Food',
  wobox_fashion: 'Wobox Fashion',
};

/** Fecha de hoy (YYYY-MM-DD) en hora de Buenos Aires, para urgencias con deadline. */
function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const CHANNEL_FORMAT_RULES: Partial<Record<Channel, string>> = {
  whatsapp: 'WhatsApp: maximo 4 oraciones, sin links, cerra con 1 sola pregunta.',
  instagram_dm: 'Instagram DM: 3-4 oraciones, tono casual.',
  linkedin: 'LinkedIn: maximo 5 oraciones.',
  phone:
    'Llamada: escribi un GUION en bullets (no un mensaje), con estas secciones: Apertura / Motivo / 2 preguntas / Cierre / Objecion "ya tenemos outlet" (con la respuesta sugerida).',
};

export interface ChannelTarget {
  value: string;
  /** De donde salio el dato: contact.* o company.* */
  source: string;
  /** true si va a un buzon/linea generica de la empresa, no a la persona. */
  generic: boolean;
}

/**
 * Destino disponible para el canal elegido. Prefiere el dato de la persona; si no hay,
 * cae al dato de la company (email generico, telefono/WhatsApp del local, IG de la marca).
 */
export function resolveChannelTarget(
  company: Pick<
    CompanyRow,
    'instagram_handle' | 'phone' | 'whatsapp' | 'generic_email' | 'linkedin_url'
  >,
  contact: Contact,
  channel: Channel,
): ChannelTarget | null {
  const pick = (...opts: Array<[unknown, string, boolean]>): ChannelTarget | null => {
    for (const [v, source, generic] of opts) {
      if (typeof v === 'string' && v.trim()) return { value: v.trim(), source, generic };
    }
    return null;
  };
  switch (channel) {
    case 'email':
      return pick(
        [contact.email, 'contact.email', false],
        [company.generic_email, 'company.generic_email', true],
      );
    case 'whatsapp':
      return pick(
        [company.whatsapp, 'company.whatsapp', true],
        [contact.phone, 'contact.phone', false],
        [company.phone, 'company.phone', true],
      );
    case 'phone':
      return pick([contact.phone, 'contact.phone', false], [company.phone, 'company.phone', true]);
    case 'instagram_dm':
      return pick(
        [contact.instagram_url, 'contact.instagram_url', false],
        [company.instagram_handle, 'company.instagram_handle', true],
      );
    case 'linkedin':
      return pick(
        [contact.linkedin_url, 'contact.linkedin_url', false],
        [company.linkedin_url, 'company.linkedin_url', true],
      );
    default:
      return null;
  }
}

function buildSystemPrompt(
  venture: Venture,
  approach: ApproachType,
  channel: Channel,
  step: number,
  genericTarget = false,
): string {
  const product = venture === 'loop' ? 'Loop' : 'Wobox';
  const channelRule =
    channel === 'email'
      ? 'FORMATO: primera linea "SUBJECT: <subject>", linea en blanco, despues "BODY: <cuerpo>". El subject es corto (max 6 palabras), sin clickbait. Firma el cuerpo con "Sebastián, Wobox".'
      : [
          'FORMATO: SOLO el texto del mensaje. No escribas "SUBJECT:", "BODY:", ni ningun header. No uses comillas ni explicaciones meta.',
          CHANNEL_FORMAT_RULES[channel] ?? '',
        ]
          .filter(Boolean)
          .join(' ');
  return [
    `Sos un SDR de ${product}, equipo argentino.`,
    'Escribis en espanol rioplatense, directo y cercano, sin jerga corporativa.',
    'Evitas "solucion integral", "propuesta de valor", "sinergia", y similares.',
    approach === 'warm_intro'
      ? 'Estas pidiendo una presentacion a un contacto en comun. Sos breve y humano.'
      : approach === 'nurture' && channel === 'email' && step > EMAIL_NURTURE_FIRST_STEP
        ? 'Es un follow-up corto de un email anterior que no tuvo respuesta. Breve, humano, sin presionar.'
        : approach === 'nurture' && channel === 'email'
          ? 'Es un email de propuesta: mencionas el producto con un call to action claro.'
          : approach === 'nurture'
            ? 'Estas construyendo familiaridad, no vendiendo. Aportas valor primero.'
            : 'Vas directo al punto con un pitch conciso y un call to action claro.',
    channelRule,
    genericTarget
      ? 'El mensaje llega a un canal general de la empresa (info@, WhatsApp o linea del local), no directo a la persona: abri saludando al equipo, menciona por nombre a quien buscas y pedi que se lo deriven.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function parseOutput(raw: string, channel: Channel): { subject: string | null; body: string } {
  let text = raw.trim();

  // Formato completo: "SUBJECT: x\nBODY: y"
  const full = text.match(/^\s*SUBJECT:\s*(.+?)\s*\n+\s*BODY:\s*([\s\S]+)$/i);
  if (full) {
    const subject = full[1]!.trim();
    const body = full[2]!.trim();
    return channel === 'email' ? { subject, body } : { subject: null, body };
  }

  // Formato parcial: "SUBJECT: x\n\n<body sin keyword BODY>"
  const partial = text.match(/^\s*SUBJECT:\s*(.+?)\s*\n+([\s\S]+)$/i);
  if (partial) {
    const subject = partial[1]!.trim();
    const body = partial[2]!.trim();
    return channel === 'email' ? { subject, body } : { subject: null, body };
  }

  // Quitar cualquier "BODY:" residual al inicio por las dudas.
  text = text.replace(/^\s*BODY:\s*/i, '');
  return { subject: null, body: text };
}

// helper re-export para tipos en CLI dispatch (no romper si DbClient no usado fuera).
export type _ = DbClient;
