import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type DbClient, type Venture, createAdminClient, createLogger } from '@wobox/core';
import { parseCsv } from './import-csv.js';
import { guessVentureFromName } from './import-from-hubspot.js';

// Migracion one-off desde los exports CSV de HubSpot (companies, contacts, deals, notes)
// hacia Supabase. HubSpot Pro no se renueva — esto reemplaza tanto el import en vivo
// (import-from-hubspot.ts, que pega a la API) como el rol que jugaba sync-hubspot:
// a partir de aca, companies.stage (deal_* enums) es la fuente de verdad del pipeline.
//
// Deals no son una entidad separada: HubSpot "deal" == este `companies` row, asi que
// el import de deals es un UPDATE sobre la company ya importada (matcheada por
// "Associated Company IDs (Primary)"), no un insert nuevo.

export interface ImportHubspotCsvOptions {
  companies?: string;
  contacts?: string;
  deals?: string;
  notes?: string;
  /** Venture fallback si no matchea heuristica por nombre/categoria */
  defaultVenture?: string;
  dryRun?: boolean;
  limit?: string;
}

const VALID_VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);

// HubSpot dealstage label (español, portal Wobox) -> nuevo stage enum.
const STAGE_MAP: Record<string, string> = {
  'Sin contacto': 'deal_sin_contacto',
  Contacto: 'deal_contacto',
  'Presentación enviada': 'deal_presentacion',
  Negociación: 'deal_negociacion',
  Onboarding: 'deal_onboarding',
  'Cierre ganado': 'deal_ganado',
  'Cierre perdido': 'deal_perdido',
};

export async function run(opts: ImportHubspotCsvOptions): Promise<void> {
  const log = createLogger('import-hubspot-csv');
  const db = createAdminClient();
  const dryRun = !!opts.dryRun;
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : Number.POSITIVE_INFINITY;
  const defaultVenture = opts.defaultVenture as Venture | undefined;
  if (defaultVenture && !VALID_VENTURES.has(defaultVenture)) {
    throw new Error(`--default-venture invalido: "${opts.defaultVenture}"`);
  }

  const unmapped = {
    ventures: [] as string[],
    stages: [] as string[],
    dealsWithoutCompany: [] as string[],
    notesWithoutCompany: [] as string[],
  };

  // ---- companies ----
  const companyIdMap = new Map<string, string>(); // hubspot "ID de registro" -> supabase company id
  // Fallback para contacts: muchos rows de HubSpot no traen "Associated Company IDs"
  // poblado (export quirk), pero si el nombre de empresa en texto plano. Name+venture
  // ya es el ultimo recurso de dedup en import-csv.ts — mismo criterio aca.
  const companyNameMap = new Map<string, string>(); // nombre normalizado -> supabase company id
  let companiesInserted = 0;
  let companiesSkipped = 0;
  if (opts.companies) {
    const rows = readCsv(opts.companies);
    log.info({ count: rows.rows.length }, 'companies CSV parseado');

    // Preload existentes por hubspot_id (dedup, idempotente en re-runs).
    const { data: existing } = await db
      .from('companies')
      .select('id, hubspot_id, name')
      .not('hubspot_id', 'is', null);
    for (const r of (existing as Array<{
      id: string;
      hubspot_id: string | null;
      name: string;
    }> | null) ?? []) {
      if (r.hubspot_id) companyIdMap.set(r.hubspot_id, r.id);
      companyNameMap.set(normalizeName(r.name), r.id);
    }

    const idx = colIndex(rows.headers, [
      'ID de registro',
      'Nombre de la empresa',
      'Nombre de dominio de la empresa',
      'Categoría comercio',
      'Ciudad',
      'Estado o región',
      'Barrio',
      'Barrio / zona',
    ]);

    let processed = 0;
    for (const row of rows.rows) {
      if (processed >= limit) break;
      processed++;
      const hubspotId = get(row, idx, 'ID de registro');
      const name = get(row, idx, 'Nombre de la empresa');
      if (!hubspotId || !name) {
        companiesSkipped++;
        continue;
      }
      if (companyIdMap.has(hubspotId)) {
        companiesSkipped++;
        continue;
      }

      const category = get(row, idx, 'Categoría comercio');
      const venture =
        guessVentureFromName(name) ?? guessVentureFromName(category) ?? defaultVenture ?? null;
      if (!venture) {
        unmapped.ventures.push(`${hubspotId}\t${name}\t${category ?? ''}`);
        companiesSkipped++;
        continue;
      }

      const region = [get(row, idx, 'Ciudad'), get(row, idx, 'Estado o región')]
        .filter(Boolean)
        .join(', ');
      const neighborhood = get(row, idx, 'Barrio') || get(row, idx, 'Barrio / zona') || null;

      if (dryRun) {
        console.log(`[DRY company] ${name} -> venture=${venture} hubspot_id=${hubspotId}`);
        // Placeholder id para que contacts/deals puedan simular el match en el mismo dry-run.
        companyIdMap.set(hubspotId, `dry:${hubspotId}`);
        companyNameMap.set(normalizeName(name), `dry:${hubspotId}`);
        companiesInserted++;
        continue;
      }

      const { data, error } = await db
        .from('companies')
        .insert({
          name,
          venture,
          website: get(row, idx, 'Nombre de dominio de la empresa') || null,
          subsector: category || null,
          region: region || null,
          neighborhood,
          source: 'hubspot',
          stage: 'qualified', // HubSpot ya las habia validado; deals step pisa esto si corresponde
          hubspot_id: hubspotId,
        } as never)
        .select('id')
        .single();

      if (error || !data) {
        log.error({ err: error?.message, name }, 'insert company fallo');
        companiesSkipped++;
        continue;
      }
      companyIdMap.set(hubspotId, (data as { id: string }).id);
      companyNameMap.set(normalizeName(name), (data as { id: string }).id);
      companiesInserted++;
    }
  }

  // ---- contacts ----
  let contactsInserted = 0;
  let contactsSkipped = 0;
  let contactsMatchedByName = 0;
  if (opts.contacts) {
    const rows = readCsv(opts.contacts);
    log.info({ count: rows.rows.length }, 'contacts CSV parseado');

    const { data: existing } = await db
      .from('contacts')
      .select('id, hubspot_id')
      .not('hubspot_id', 'is', null);
    const existingContactIds = new Set(
      ((existing as Array<{ hubspot_id: string | null }> | null) ?? [])
        .map((r) => r.hubspot_id)
        .filter((x): x is string => !!x),
    );

    const idx = colIndex(rows.headers, [
      'ID de registro',
      'Nombre',
      'Apellidos',
      'Correo',
      'Cargo',
      'Associated Company IDs',
      'Nombre de la empresa',
    ]);

    let processed = 0;
    for (const row of rows.rows) {
      if (processed >= limit) break;
      processed++;
      const hubspotId = get(row, idx, 'ID de registro');
      if (!hubspotId || existingContactIds.has(hubspotId)) {
        contactsSkipped++;
        continue;
      }

      // La mayoria de los exports de HubSpot no traen "Associated Company IDs" poblado
      // para contacts (quirk confirmado: ~12/710 en el export real) — fallback a
      // matchear por nombre de empresa en texto plano contra companies ya importadas.
      const firstCompanyHsId = firstAssociatedId(get(row, idx, 'Associated Company IDs'));
      let companyId = firstCompanyHsId ? companyIdMap.get(firstCompanyHsId) : undefined;
      if (!companyId) {
        const companyName = get(row, idx, 'Nombre de la empresa');
        if (companyName) {
          companyId = companyNameMap.get(normalizeName(companyName));
          if (companyId) contactsMatchedByName++;
        }
      }
      if (!companyId) {
        contactsSkipped++;
        continue;
      }

      const name = [get(row, idx, 'Nombre'), get(row, idx, 'Apellidos')]
        .filter(Boolean)
        .join(' ')
        .trim();
      const email = get(row, idx, 'Correo');
      if (!name && !email) {
        contactsSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(`[DRY contact] ${name || email} -> company=${companyId}`);
        contactsInserted++;
        continue;
      }

      const { error } = await db.from('contacts').insert({
        company_id: companyId,
        hubspot_id: hubspotId,
        name: name || email || 'Sin nombre',
        role: get(row, idx, 'Cargo') || null,
        email: email ? email.toLowerCase() : null,
        contact_source: 'HubSpot import',
        is_decision_maker: false,
      } as never);

      if (error) {
        log.warn({ err: error.message, name }, 'insert contact fallo');
        contactsSkipped++;
        continue;
      }
      contactsInserted++;
    }
  }

  // ---- deals (= update sobre companies ya importadas) ----
  let dealsUpdated = 0;
  let dealsSkipped = 0;
  const dealIdToCompanyId = new Map<string, string>(); // hubspot deal id -> supabase company id
  if (opts.deals) {
    const rows = readCsv(opts.deals);
    log.info({ count: rows.rows.length }, 'deals CSV parseado');

    const ownerMap = await buildOwnerMap(db);

    const idx = colIndex(rows.headers, [
      'ID de registro',
      'Etapa del negocio',
      'Valor en la divisa de la empresa',
      'Valor',
      'Motivo de cierres perdidos',
      'Propietario del negocio',
      'Associated Company IDs (Primary)',
      'Fecha de cierre',
      'Fecha de creación',
    ]);

    let processed = 0;
    for (const row of rows.rows) {
      if (processed >= limit) break;
      processed++;

      const hubspotDealId = get(row, idx, 'ID de registro');
      const hubspotCompanyId = get(row, idx, 'Associated Company IDs (Primary)');
      const companyId = hubspotCompanyId ? companyIdMap.get(hubspotCompanyId) : undefined;
      if (!companyId) {
        if (hubspotDealId) unmapped.dealsWithoutCompany.push(hubspotDealId);
        dealsSkipped++;
        continue;
      }
      if (hubspotDealId) dealIdToCompanyId.set(hubspotDealId, companyId);

      const hsStage = get(row, idx, 'Etapa del negocio');
      const stage = hsStage ? STAGE_MAP[hsStage] : undefined;
      if (!stage) {
        if (hsStage) unmapped.stages.push(`${hubspotDealId}\t${hsStage}`);
        dealsSkipped++;
        continue;
      }

      const rawValue = get(row, idx, 'Valor en la divisa de la empresa') || get(row, idx, 'Valor');
      const dealValue = rawValue ? Number(rawValue.replace(/[^0-9.-]/g, '')) : null;
      const lostReason =
        stage === 'deal_perdido' ? get(row, idx, 'Motivo de cierres perdidos') || null : null;
      const ownerName = get(row, idx, 'Propietario del negocio');
      const assignedTo = ownerName ? ownerMap.get(normalizeName(ownerName)) : undefined;
      const stageEnteredAt =
        get(row, idx, 'Fecha de cierre') || get(row, idx, 'Fecha de creación') || undefined;

      if (dryRun) {
        console.log(`[DRY deal] company=${companyId} stage=${stage} value=${dealValue ?? '-'}`);
        dealsUpdated++;
        continue;
      }

      const { error } = await db
        .from('companies')
        .update({
          stage,
          hubspot_deal_id: hubspotDealId || null,
          deal_value: Number.isFinite(dealValue) ? dealValue : null,
          lost_reason: lostReason,
          ...(assignedTo ? { assigned_to: assignedTo } : {}),
          ...(stageEnteredAt ? { stage_entered_at: new Date(stageEnteredAt).toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', companyId);

      if (error) {
        log.error({ err: error.message, companyId }, 'update deal fallo');
        dealsSkipped++;
        continue;
      }
      dealsUpdated++;
    }
  }

  // ---- notes -> interactions ----
  let notesInserted = 0;
  let notesSkipped = 0;
  let notesMatchedByDeal = 0;
  if (opts.notes) {
    const rows = readCsv(opts.notes);
    log.info({ count: rows.rows.length }, 'notes CSV parseado');

    const idx = colIndex(rows.headers, [
      'Cuerpo de la nota',
      'Fecha de actividad',
      'Fecha de creación',
      'Associated Company IDs',
      'Associated Contact IDs',
      'Associated Deal IDs',
    ]);

    let processed = 0;
    for (const row of rows.rows) {
      if (processed >= limit) break;
      processed++;

      const body = get(row, idx, 'Cuerpo de la nota');
      if (!body) {
        notesSkipped++;
        continue;
      }

      // La mayoria de las notas no traen "Associated Company IDs" directo (quirk del
      // export), pero si "Associated Deal IDs" — resolvemos via el deal ya matcheado.
      const hsCompanyId = firstAssociatedId(get(row, idx, 'Associated Company IDs'));
      let companyId = hsCompanyId ? companyIdMap.get(hsCompanyId) : undefined;
      if (!companyId) {
        const hsDealId = firstAssociatedId(get(row, idx, 'Associated Deal IDs'));
        if (hsDealId) {
          companyId = dealIdToCompanyId.get(hsDealId);
          if (companyId) notesMatchedByDeal++;
        }
      }
      if (!companyId) {
        notesSkipped++;
        continue;
      }

      const performedAt = get(row, idx, 'Fecha de actividad') || get(row, idx, 'Fecha de creación');

      if (dryRun) {
        notesInserted++;
        continue;
      }

      const { error } = await db.from('interactions').insert({
        company_id: companyId,
        type: 'note',
        channel: 'internal',
        content: body,
        ai_generated: false,
        outcome: 'pending',
        performed_at: performedAt ? new Date(performedAt).toISOString() : new Date().toISOString(),
      } as never);

      if (error) {
        log.warn({ err: error.message }, 'insert note fallo');
        notesSkipped++;
        continue;
      }
      notesInserted++;
    }
  }

  console.log(`\nimport-hubspot-csv done${dryRun ? ' (DRY-RUN)' : ''}:`);
  console.log(`  companies: inserted=${companiesInserted} skipped=${companiesSkipped}`);
  console.log(
    `  contacts:  inserted=${contactsInserted} skipped=${contactsSkipped} (matched by name: ${contactsMatchedByName})`,
  );
  console.log(`  deals:     updated=${dealsUpdated} skipped=${dealsSkipped}`);
  console.log(
    `  notes:     inserted=${notesInserted} skipped=${notesSkipped} (matched via deal: ${notesMatchedByDeal})`,
  );

  if (unmapped.ventures.length || unmapped.stages.length || unmapped.dealsWithoutCompany.length) {
    console.log('\n--- sin mapear (revisar) ---');
    if (unmapped.ventures.length) {
      console.log(`ventures sin heuristica (${unmapped.ventures.length}):`);
      for (const v of unmapped.ventures.slice(0, 20)) console.log(`  ${v}`);
    }
    if (unmapped.stages.length) {
      console.log(`stages sin mapear (${unmapped.stages.length}):`);
      for (const s of unmapped.stages.slice(0, 20)) console.log(`  ${s}`);
    }
    if (unmapped.dealsWithoutCompany.length) {
      console.log(`deals sin company matcheada (${unmapped.dealsWithoutCompany.length}):`);
      for (const d of unmapped.dealsWithoutCompany.slice(0, 20)) console.log(`  ${d}`);
    }
  }
}

// ========================
// helpers
// ========================

function readCsv(path: string): { headers: string[]; rows: string[][] } {
  const raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  return parseCsv(raw);
}

function colIndex(headers: string[], wanted: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of wanted) {
    const i = headers.indexOf(w.toLowerCase());
    map.set(w, i);
  }
  return map;
}

function get(row: string[], idx: Map<string, number>, col: string): string {
  const i = idx.get(col);
  if (i === undefined || i < 0) return '';
  return (row[i] ?? '').trim();
}

function firstAssociatedId(raw: string): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0]?.trim();
  return first || null;
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

async function buildOwnerMap(db: DbClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 200 });
    if (error || !data) return map;
    for (const u of data.users) {
      if (!u.email) continue;
      const displayName = (u.user_metadata?.full_name || u.user_metadata?.name || '') as string;
      if (displayName) map.set(normalizeName(displayName), u.id);
      // Tambien mapear por email prefix (ej "sebastian.bazan" o "sebastian") por si no hay full_name.
      map.set(normalizeName(u.email.split('@')[0]!.replace('.', ' ')), u.id);
    }
  } catch {
    // best-effort: si falla, assigned_to queda sin setear (no rompe el import)
  }
  return map;
}
