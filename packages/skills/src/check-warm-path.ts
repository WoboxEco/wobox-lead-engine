import { type DbClient, createAdminClient, createLogger } from '@wobox/core';
import { apollo } from '@wobox/integrations';

export interface CheckWarmPathOptions {
  id?: string;
  path?: 'direct' | '2nd_degree' | 'none';
  connector?: string;
  decisionMaker?: string;
  email?: string;
  role?: string;
  venture?: string;
  auto?: boolean;
  autoLimit?: number;
  autoMinScore?: number;
  autoReveal?: boolean;
}

export async function run(opts: CheckWarmPathOptions): Promise<void> {
  const db = createAdminClient();
  const log = createLogger('check-warm-path');

  if (opts.auto) {
    await autoCheck(db, log, {
      venture: opts.venture ?? 'loop',
      limit: opts.autoLimit ?? 10,
      minScore: opts.autoMinScore ?? 70,
      reveal: opts.autoReveal ?? false,
    });
    return;
  }

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
  console.log('  pnpm skill check-warm-path --auto               # detecta warm paths con Apollo API');
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

// =========================================================================
// --auto: detecta warm paths consultando Apollo
// =========================================================================

interface AutoOpts {
  venture: string;
  limit: number;
  minScore: number;
  reveal: boolean;
}

type PendingCompany = {
  id: string;
  name: string;
  website: string | null;
  apollo_id: string | null;
  score: number | null;
};

async function autoCheck(
  db: DbClient,
  log: ReturnType<typeof createLogger>,
  opts: AutoOpts,
): Promise<void> {
  const pending = await loadPendingForAuto(db, opts);
  if (pending.length === 0) {
    console.log('No hay leads pending de warm-path check para --auto');
    return;
  }

  console.log(
    `\nProcesando ${pending.length} leads (venture=${opts.venture}, minScore=${opts.minScore}, reveal=${opts.reveal}):\n`,
  );

  let direct = 0;
  let secondDegree = 0;
  let dmFound = 0;
  let revealed = 0;
  let skipped = 0;

  const SOCIAL_ONLY_HOSTS = /(^|\.)(instagram|facebook|tiktok|twitter|x|linkedin|google)\.com/;

  for (const c of pending) {
    const header = `[${c.name}]`;
    if (!c.website) {
      console.log(`${header} skip: sin website`);
      skipped++;
      continue;
    }
    if (!c.apollo_id && SOCIAL_ONLY_HOSTS.test(c.website.toLowerCase())) {
      console.log(`${header} skip: website es social profile (${c.website}), requiere enrich-lead para resolver dominio real`);
      skipped++;
      continue;
    }

    const account = c.apollo_id
      ? { id: c.apollo_id, name: c.name }
      : await apollo.searchAccount(c.website).catch((err) => {
          log.warn({ err: String(err), company: c.name }, 'apollo searchAccount failed');
          return null;
        });

    if (!account) {
      console.log(`${header} skip: no match en Apollo para ${c.website}`);
      skipped++;
      continue;
    }

    if (!c.apollo_id) {
      await db.from('companies').update({ apollo_id: account.id }).eq('id', c.id);
    }

    // 1. Warm connections
    const connections = await apollo.findWarmConnections(account.id).catch(() => []);
    if (connections.length > 0) {
      const result = await handleWarmConnections(db, c, connections);
      if (result === 'direct') direct++;
      else secondDegree++;
      console.log(
        `${header} warm=${result} via ${connections[0]?.name} (${connections[0]?.title ?? 'sin title'})`,
      );
      continue;
    }

    // 2. Decision makers (teasers, bajo costo)
    const dms = await apollo.searchDecisionMakers({ orgId: account.id }).catch(() => []);
    if (dms.length === 0) {
      console.log(`${header} sin warm, sin decision makers detectados`);
      skipped++;
      continue;
    }
    dmFound += dms.length;

    // 3. Reveal solo si score >= minScore y --reveal
    const score = c.score ?? 0;
    if (opts.reveal && score >= opts.minScore) {
      const top = dms[0];
      if (!top) {
        console.log(`${header} dms vacio tras filtrado (bug)`);
        skipped++;
        continue;
      }
      const full = await apollo
        .matchPerson({
          personId: top.id,
          organizationName: c.name,
          firstName: top.first_name,
          venture: opts.venture as 'wobox_food' | 'wobox_fashion' | 'loop',
          operation: 'check-warm-path:match',
        })
        .catch((err) => {
          log.warn({ err: String(err), company: c.name }, 'apollo matchPerson failed');
          return null;
        });
      if (full) {
        revealed++;
        await upsertContact(db, c.id, {
          name: full.name,
          role: full.title ?? top.title ?? null,
          email: full.email ?? null,
          linkedin_url: full.linkedin_url ?? null,
          warm_path: 'none',
          is_decision_maker: true,
          contact_source: 'apollo (auto-reveal)',
        });
        console.log(
          `${header} revealed DM: ${full.name} (${full.title ?? '?'}) email=${full.email ?? 'n/a'}`,
        );
      } else {
        console.log(`${header} reveal fallido para ${top.first_name} ${top.last_name_obfuscated}`);
      }
    } else {
      const preview = dms
        .slice(0, 3)
        .map((d) => `${d.first_name} ${d.last_name_obfuscated ?? ''} (${d.title ?? '?'})`)
        .join(', ');
      console.log(
        `${header} sin warm, ${dms.length} DM teasers: ${preview}${score < opts.minScore ? ` [score ${score} < ${opts.minScore}]` : ''}`,
      );
    }
  }

  console.log(`\nResumen:`);
  console.log(`  direct:        ${direct}`);
  console.log(`  2nd_degree:    ${secondDegree}`);
  console.log(`  DM teasers:    ${dmFound}`);
  console.log(`  revelados:     ${revealed} (${revealed} creditos)`);
  console.log(`  skipped:       ${skipped}`);
}

async function loadPendingForAuto(db: DbClient, opts: AutoOpts): Promise<PendingCompany[]> {
  type Row = {
    id: string;
    name: string;
    website: string | null;
    apollo_id: string | null;
    scores: Array<{ total_score: number; scored_at: string }>;
    contacts: Array<{ warm_path: string }>;
  };

  const { data, error } = await db
    .from('companies')
    .select('id, name, website, apollo_id, scores(total_score, scored_at), contacts(warm_path)')
    .in('stage', ['qualified', 'nurturing'])
    .eq('venture', opts.venture);
  if (error) throw new Error(error.message);

  const rows = ((data as unknown as Row[]) ?? [])
    .map((r) => {
      const latest = r.scores.slice().sort((a, b) => b.scored_at.localeCompare(a.scored_at))[0];
      const hasWarm = r.contacts.some(
        (c) => c.warm_path === 'direct' || c.warm_path === '2nd_degree',
      );
      return {
        id: r.id,
        name: r.name,
        website: r.website,
        apollo_id: r.apollo_id,
        score: latest?.total_score ?? null,
        hasWarm,
      };
    })
    .filter((r) => !r.hasWarm)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, opts.limit);

  return rows;
}

async function handleWarmConnections(
  db: DbClient,
  c: PendingCompany,
  connections: Awaited<ReturnType<typeof apollo.findWarmConnections>>,
): Promise<'direct' | '2nd_degree'> {
  const seniorTitles = /ceo|founder|owner|managing director|co.?founder|president|duen|director/i;
  const senior = connections.find((x) => x.title && seniorTitles.test(x.title));
  const chosen = senior ?? connections[0];
  if (!chosen) return '2nd_degree';

  const path: 'direct' | '2nd_degree' = senior ? 'direct' : '2nd_degree';

  await upsertContact(db, c.id, {
    name: chosen.name,
    role: chosen.title ?? null,
    email: chosen.email ?? null,
    linkedin_url: chosen.linkedin_url ?? null,
    warm_path: path,
    warm_connector: chosen.owner_id ?? 'apollo:connection',
    is_decision_maker: path === 'direct',
    contact_source: 'apollo (auto-warm)',
  });

  return path;
}

async function upsertContact(
  db: DbClient,
  companyId: string,
  payload: {
    name: string;
    role?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    warm_path: 'direct' | '2nd_degree' | 'none';
    warm_connector?: string;
    is_decision_maker: boolean;
    contact_source: string;
  },
): Promise<void> {
  // Match: email primero, luego linkedin_url, luego name.
  let existingId: string | null = null;
  if (payload.email) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('company_id', companyId)
      .eq('email', payload.email.toLowerCase())
      .maybeSingle();
    if (data) existingId = (data as { id: string }).id;
  }
  if (!existingId && payload.linkedin_url) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('company_id', companyId)
      .eq('linkedin_url', payload.linkedin_url)
      .maybeSingle();
    if (data) existingId = (data as { id: string }).id;
  }
  if (!existingId) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('company_id', companyId)
      .ilike('name', payload.name)
      .maybeSingle();
    if (data) existingId = (data as { id: string }).id;
  }

  const row = {
    company_id: companyId,
    name: payload.name,
    role: payload.role ?? null,
    email: payload.email ? payload.email.toLowerCase() : null,
    linkedin_url: payload.linkedin_url ?? null,
    warm_path: payload.warm_path,
    warm_connector: payload.warm_connector ?? null,
    is_decision_maker: payload.is_decision_maker,
    contact_source: payload.contact_source,
  };

  if (existingId) {
    await db.from('contacts').update(row).eq('id', existingId);
  } else {
    await db.from('contacts').insert(row);
  }
}
