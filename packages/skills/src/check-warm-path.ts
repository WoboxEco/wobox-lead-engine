import { type DbClient, createAdminClient, createLogger } from '@wobox/core';

export interface CheckWarmPathOptions {
  id?: string;
  path?: 'direct' | '2nd_degree' | 'none';
  connector?: string;
  decisionMaker?: string;
  email?: string;
  role?: string;
  venture?: string;
}

export async function run(opts: CheckWarmPathOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('check-warm-path');

  if (!opts.id) {
    await listPending(db, opts.venture ?? 'loop');
    return;
  }

  if (!opts.path) {
    throw new Error('--path requerido: direct | 2nd_degree | none');
  }

  if (opts.path !== 'none' && !opts.decisionMaker) {
    throw new Error('Si --path=direct|2nd_degree, requiere --decision-maker "<nombre>"');
  }

  await markWarmPath(db, opts, log);
}

async function listPending(db: DbClient, venture: string): Promise<void> {
  type Row = {
    id: string;
    name: string;
    venture: string;
    neighborhood: string | null;
    instagram_handle: string | null;
    buyer_persona: string | null;
    stage: string;
    scores: Array<{ total_score: number; scored_at: string }>;
    contacts: Array<{ warm_path: string }>;
  };

  const { data, error } = await db
    .from('companies')
    .select(
      'id, name, venture, neighborhood, instagram_handle, buyer_persona, stage, scores(total_score, scored_at), contacts(warm_path)',
    )
    .in('stage', ['qualified', 'nurturing'])
    .eq('venture', venture);
  if (error) throw new Error(error.message);

  const rows = ((data as unknown as Row[]) ?? []).map((r) => {
    const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
    const hasWarm = r.contacts.some(
      (c) => c.warm_path === 'direct' || c.warm_path === '2nd_degree',
    );
    return { ...r, score: latest?.total_score ?? null, hasWarm };
  });

  const pending = rows.filter((r) => !r.hasWarm).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  if (pending.length === 0) {
    console.log('No hay leads pending de warm-path check');
    return;
  }

  console.log(`\n${pending.length} leads sin warm-path detectado (ordenados por score):\n`);
  console.log('ID'.padEnd(38), 'SC'.padStart(3), 'BP'.padEnd(4), 'NAME'.padEnd(50), 'NEIGHBORHOOD');
  console.log('-'.repeat(120));
  for (const r of pending) {
    console.log(
      r.id,
      String(r.score ?? '-').padStart(3),
      (r.buyer_persona ?? '-').padEnd(4),
      (r.name ?? '').slice(0, 49).padEnd(50),
      r.neighborhood ?? '-',
    );
  }
  console.log('\nEjemplos:');
  console.log(
    '  pnpm skill check-warm-path --id=<uuid> --path=direct \\',
    '\n    --connector="Yo (founder)" --decision-maker="Nombre Apellido" \\',
    '\n    --email="contacto@empresa.ar" --role="CEO"',
  );
  console.log(
    '  pnpm skill check-warm-path --id=<uuid> --path=none      # marca como "sin warm path"',
  );
}

async function markWarmPath(
  db: DbClient,
  opts: CheckWarmPathOptions,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const { data: company, error } = await db
    .from('companies')
    .select('id, name, venture')
    .eq('id', opts.id ?? '')
    .single();
  if (error || !company) throw new Error(`company ${opts.id} no existe`);
  const c = company as { id: string; name: string; venture: string };

  // path=none: marca todos los contactos existentes como none, sin crear nuevo.
  if (opts.path === 'none') {
    await db
      .from('contacts')
      .update({ warm_path: 'none', warm_connector: null })
      .eq('company_id', c.id);
    log.info({ company: c.name }, 'marcado como sin warm-path');
    return;
  }

  // Buscar contacto existente por email (preferido) o por name.
  let existingId: string | null = null;
  if (opts.email) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('company_id', c.id)
      .eq('email', opts.email.toLowerCase())
      .maybeSingle();
    if (data) existingId = (data as { id: string }).id;
  }
  if (!existingId && opts.decisionMaker) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('company_id', c.id)
      .ilike('name', opts.decisionMaker)
      .maybeSingle();
    if (data) existingId = (data as { id: string }).id;
  }

  const payload = {
    warm_path: opts.path,
    warm_connector: opts.connector ?? null,
    is_decision_maker: true,
    contact_source: 'manual (warm-path mark)',
  };

  if (existingId) {
    const { error: updateErr } = await db
      .from('contacts')
      .update({
        ...payload,
        ...(opts.email ? { email: opts.email.toLowerCase() } : {}),
        ...(opts.role ? { role: opts.role } : {}),
      })
      .eq('id', existingId);
    if (updateErr) throw new Error(`update contact: ${updateErr.message}`);
    log.info({ company: c.name, contactId: existingId, path: opts.path }, 'warm-path actualizado');
    return;
  }

  // Insertar nuevo decision maker.
  const { data: inserted, error: insertErr } = await db
    .from('contacts')
    .insert({
      company_id: c.id,
      name: opts.decisionMaker,
      ...(opts.email ? { email: opts.email.toLowerCase() } : {}),
      ...(opts.role ? { role: opts.role } : {}),
      ...payload,
    })
    .select('id')
    .single();
  if (insertErr) throw new Error(`insert contact: ${insertErr.message}`);
  const newId = (inserted as { id: string }).id;
  log.info({ company: c.name, contactId: newId, path: opts.path }, 'contacto creado con warm-path');
}
