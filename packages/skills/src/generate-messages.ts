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

// Default: Sonnet. La generacion de mensajes depende de voz argentina + creatividad
// + adaptacion por BP/canal. Override con --model=haiku solo para pruebas de volumen.
export const DEFAULT_MODEL = 'sonnet';

export interface GenerateMessagesOptions {
  id?: string;
  contactId?: string;
  approach?: ApproachType;
  channel?: Channel;
  step?: string;
  model?: string;
}

export async function run(opts: GenerateMessagesOptions): Promise<void> {
  const log = createLogger('generate-messages');
  const db = createAdminClient();

  if (!opts.id) throw new Error('Requiere --id <company_uuid>');
  const model = opts.model ?? DEFAULT_MODEL;
  const channel: Channel = opts.channel ?? 'linkedin';
  const step = Number.parseInt(opts.step ?? '1', 10);

  // Fetch company + latest score + contacts.
  const { data: companyData, error: fetchErr } = await db
    .from('companies')
    .select('*, contacts(*), scores(total_score, scoring_model, ai_reasoning, scored_at)')
    .eq('id', opts.id)
    .single();

  if (fetchErr || !companyData) {
    throw new Error(`Company ${opts.id} not found: ${fetchErr?.message}`);
  }

  const company = companyData as unknown as Record<string, unknown> & {
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
    contacts: Contact[];
    scores: Array<{
      total_score: number;
      scoring_model: string;
      ai_reasoning: string;
      scored_at: string;
    }>;
  };

  const contact = selectContact(company.contacts, opts.contactId);
  if (!contact) {
    throw new Error(
      `Company ${company.name} no tiene contacts. Insertar un contact primero (idealmente con is_decision_maker=true).`,
    );
  }

  const latestScore = company.scores
    .slice()
    .sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];

  const approach = opts.approach ?? selectApproach(contact, latestScore?.total_score);
  const promptName = selectPromptName(company.venture, company.vertical, approach);
  const vars = buildVars({
    company,
    contact,
    channel,
    step,
    ...(latestScore ? { score: latestScore } : {}),
  });

  log.info(
    { model, approach, channel, promptName, contactName: contact.name },
    'generating message',
  );

  try {
    const prompt = await loadPrompt('messages', promptName, vars);
    const system = buildSystemPrompt(company.venture, approach, channel);
    const rawOutput = await claude.completeText({
      system,
      user: prompt,
      venture: company.venture,
      operation: `generate-${promptName}`,
      model,
      maxTokens: 1024,
    });

    const { subject, body } = parseOutput(rawOutput, channel);

    const { error: insertErr } = await db.from('messages').insert({
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
    });
    if (insertErr) throw new Error(`insert message: ${insertErr.message}`);

    log.info({ promptName, approach, channel }, 'draft message saved');
  } catch (err) {
    log.error({ err, companyId: company.id }, 'generation failed');
    await writeErrorLog(db, {
      skill: 'generate-messages',
      error: err,
      companyId: company.id,
      context: { approach, channel, promptName, step },
    });
    throw err;
  }
}

type Contact = Record<string, unknown> & {
  id: string;
  name: string;
  role?: string;
  email?: string;
  warm_path?: 'direct' | '2nd_degree' | 'none';
  warm_connector?: string;
  is_decision_maker?: boolean;
};

function selectContact(contacts: Contact[], preferId?: string): Contact | null {
  if (!contacts || contacts.length === 0) return null;
  if (preferId) return contacts.find((c) => c.id === preferId) ?? null;
  return contacts.find((c) => c.is_decision_maker) ?? contacts[0] ?? null;
}

function selectApproach(contact: Contact, totalScore: number | undefined): ApproachType {
  if (contact.warm_path === 'direct' || contact.warm_path === '2nd_degree') return 'warm_intro';
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
  // Wobox: warm_intro es compartido; nurture y direct se bifurcan por vertical.
  if (approach === 'warm_intro') return 'message-wobox-warm-intro-v1';
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
  };
}

function buildSystemPrompt(venture: Venture, approach: ApproachType, channel: Channel): string {
  const product = venture === 'loop' ? 'Loop' : 'Wobox';
  const channelRule =
    channel === 'email'
      ? 'FORMATO: primera linea "SUBJECT: <subject>", linea en blanco, despues "BODY: <cuerpo>".'
      : 'FORMATO: SOLO el texto del mensaje. No escribas "SUBJECT:", "BODY:", ni ningun header. No uses comillas ni explicaciones meta.';
  return [
    `Sos un SDR de ${product}, equipo argentino.`,
    'Escribis en espanol rioplatense, directo y cercano, sin jerga corporativa.',
    'Evitas "solucion integral", "propuesta de valor", "sinergia", y similares.',
    approach === 'warm_intro'
      ? 'Estas pidiendo una presentacion a un contacto en comun. Sos breve y humano.'
      : approach === 'nurture'
        ? 'Estas construyendo familiaridad, no vendiendo. Aportas valor primero.'
        : 'Vas directo al punto con un pitch conciso y un call to action claro.',
    channelRule,
  ].join(' ');
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
