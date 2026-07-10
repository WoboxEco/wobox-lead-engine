import {
  type DbClient,
  type Venture,
  createAdminClient,
  createLogger,
  writeErrorLog,
} from '@wobox/core';
import { hubspot } from '@wobox/integrations';

export interface ImportFromHubspotOptions {
  /** Venture default si la company en HubSpot no tiene la propiedad `venture` seteada */
  venture?: string;
  /** Stage para companies importadas. Default: 'qualified' (asume que HubSpot ya las valido) */
  stage?: string;
  /** Procesar solo N companies en vez de iterar todas */
  limit?: string;
  /** No insertar nada, solo loguear */
  dryRun?: boolean;
  /** Saltear companies cuyo lifecyclestage es "customer" o "subscriber" */
  skipExisting?: boolean;
}

const VALID_VENTURES = new Set<Venture>(['wobox_food', 'wobox_fashion', 'loop']);
const DEFAULT_STAGE = 'qualified';
const SKIP_LIFECYCLE = new Set(['customer', 'subscriber', 'evangelist']);

// Heuristica de venture por nombre. Match en orden: loop -> wobox_food -> wobox_fashion.
// Si nada matchea, cae al --venture default.
export const VENTURE_KEYWORDS: Array<{ venture: Venture; keywords: string[] }> = [
  {
    venture: 'loop',
    keywords: [
      'cafe',
      'café',
      'cafeteria',
      'cafetería',
      'panaderia',
      'panadería',
      'heladeria',
      'heladería',
      'rotiseria',
      'rotisería',
      'almacen',
      'almacén',
      'dietetica',
      'dietética',
      'pasteleria',
      'pastelería',
      'pizzeria',
      'pizzería',
      'parrilla',
      'restaurant',
      'resto',
      'bistro',
      'sushi',
      'burger',
      'wellness',
      'spa',
      'yoga',
      'pilates',
      'gym',
      'gimnasio',
      'crossfit',
      'studio',
      'estudio de',
      'peluqueria',
      'peluquería',
      'barber',
      'estetica',
      'estética',
      'manicure',
      'manicuría',
      'specialty coffee',
      'coffee',
      'tea',
      'té',
      'eco tienda',
      'ecotienda',
      'almacen natural',
      'tienda natural',
    ],
  },
  {
    venture: 'wobox_fashion',
    keywords: [
      'indumentaria',
      'moda',
      'ropa',
      'vestimenta',
      'vestido',
      'calzado',
      'fashion',
      'apparel',
      'shoes',
      'jeans',
      'lenceria',
      'lencería',
      'accesorios',
      'sastreria',
      'sastrería',
      'textil',
    ],
  },
  {
    venture: 'wobox_food',
    keywords: [
      'distribuidora',
      'distribuidor',
      'mayorista',
      'frigorifico',
      'frigorífico',
      'cooperativa',
      'importadora',
      'industria alimenticia',
      'alimentos s.a',
      'alimentos sa',
      'alimentos srl',
      'molino',
      'lacteos',
      'lácteos',
      'agroindustria',
    ],
  },
];

export function guessVentureFromName(name: string | null | undefined): Venture | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const { venture, keywords } of VENTURE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return venture;
  }
  return null;
}

export async function run(opts: ImportFromHubspotOptions): Promise<void> {
  const log = createLogger('import-from-hubspot');
  const db = createAdminClient();

  const fallbackVenture = opts.venture as Venture | undefined;
  if (fallbackVenture && !VALID_VENTURES.has(fallbackVenture)) {
    throw new Error(
      `import-from-hubspot: --venture invalido "${opts.venture}". Esperado: wobox_food | wobox_fashion | loop`,
    );
  }
  const stage = opts.stage ?? DEFAULT_STAGE;
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : Number.POSITIVE_INFINITY;
  const dryRun = !!opts.dryRun;

  log.info({ fallbackVenture, stage, limit, dryRun }, 'starting hubspot import');

  // Cargar mapeo de hubspot_id existentes para dedup rapido (sin pegarle a Supabase 1 por 1).
  const { data: existingRows } = await db.from('companies').select('id, hubspot_id, name, venture');
  const existingByHubspotId = new Map<string, { id: string; name: string; venture: string }>();
  for (const r of (existingRows as Array<{
    id: string;
    hubspot_id: string | null;
    name: string;
    venture: string;
  }> | null) ?? []) {
    if (r.hubspot_id) {
      existingByHubspotId.set(r.hubspot_id, {
        id: r.id,
        name: r.name,
        venture: r.venture,
      });
    }
  }
  log.info({ existing: existingByHubspotId.size }, 'preloaded existing companies by hubspot_id');

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  const updated = 0;
  let contactsAdded = 0;
  let withoutVenture = 0;
  const ventureBreakdown: Record<Venture, number> = {
    wobox_food: 0,
    wobox_fashion: 0,
    loop: 0,
  };
  let matchedByHeuristic = 0;
  let matchedByFallback = 0;

  try {
    for await (const hsCompany of hubspot.iterateAllCompanies()) {
      if (processed >= limit) break;
      processed++;

      if (!hsCompany.name) {
        log.warn({ hubspotId: hsCompany.id }, 'company sin name, skip');
        skipped++;
        continue;
      }

      // Filtrar customers / suscribers (ya cerrados) salvo override
      if (
        opts.skipExisting !== false &&
        hsCompany.lifecycleStage &&
        SKIP_LIFECYCLE.has(hsCompany.lifecycleStage)
      ) {
        skipped++;
        continue;
      }

      // Resolucion de venture (orden de prioridad):
      //   1. Property venture en HubSpot (si la usaste)
      //   2. Heuristica por nombre (cafe -> loop, distribuidora -> wobox_food, etc.)
      //   3. --venture flag como fallback
      let venture: Venture | null = hsCompany.venture;
      let source: 'hubspot' | 'heuristic' | 'fallback' = 'hubspot';
      if (!venture) {
        const guessed = guessVentureFromName(hsCompany.name);
        if (guessed) {
          venture = guessed;
          source = 'heuristic';
          matchedByHeuristic++;
        } else if (fallbackVenture) {
          venture = fallbackVenture;
          source = 'fallback';
          matchedByFallback++;
        }
      }
      if (!venture) {
        withoutVenture++;
        log.warn(
          { name: hsCompany.name, hubspotId: hsCompany.id },
          'company sin venture (HubSpot vacio + heuristica fallo + sin --venture), skip',
        );
        skipped++;
        continue;
      }
      ventureBreakdown[venture]++;

      const existing = existingByHubspotId.get(hsCompany.id);
      if (existing) {
        // Ya existe — no la duplicamos. Podemos hacer update light si hace falta.
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(
          `[DRY] ${hsCompany.name} → venture=${venture} (${source}) hubspot_id=${hsCompany.id}`,
        );
        inserted++;
        continue;
      }

      try {
        const newCompanyId = await insertCompany(db, hsCompany, venture, stage);
        inserted++;

        // Traer + insertar contacts asociados
        try {
          const hsContacts = await hubspot.listCompanyContacts(hsCompany.id);
          if (hsContacts.length > 0) {
            const added = await insertContacts(db, hsContacts, newCompanyId);
            contactsAdded += added;
          }
        } catch (err) {
          log.warn(
            { err: String(err), company: hsCompany.name },
            'fetch/insert contacts fallo (se importa company sin contacts)',
          );
        }
      } catch (err) {
        log.error(
          { err: String(err), name: hsCompany.name, hubspotId: hsCompany.id },
          'insert company fallo',
        );
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, 'iterateAllCompanies fallo');
    await writeErrorLog(db, {
      skill: 'import-from-hubspot',
      error: err,
      context: { processed, inserted, skipped },
    });
    throw err;
  }

  // Track usage (no son creditos pero loguear que corrimos algo).
  if (!dryRun) {
    await db.from('api_usage').insert({
      service: 'hubspot',
      operation: 'import-companies',
      credits_used: 0,
      tokens_used: null,
      venture: fallbackVenture ?? null,
    });
  }

  console.log(
    `\nimport-from-hubspot done: processed=${processed} inserted=${inserted} updated=${updated} skipped=${skipped} contacts=${contactsAdded} sin_venture=${withoutVenture}${dryRun ? ' (DRY-RUN)' : ''}`,
  );
  console.log(
    `  asignacion: heuristica=${matchedByHeuristic} fallback=${matchedByFallback} | breakdown: loop=${ventureBreakdown.loop} food=${ventureBreakdown.wobox_food} fashion=${ventureBreakdown.wobox_fashion}`,
  );
}

async function insertCompany(
  db: DbClient,
  hsCompany: hubspot.HubspotCompany,
  venture: Venture,
  stage: string,
): Promise<string> {
  const region =
    [hsCompany.city, hsCompany.state, hsCompany.country]
      .filter((s): s is string => Boolean(s))
      .join(', ') || null;

  const { data, error } = await db
    .from('companies')
    .insert({
      name: hsCompany.name as string,
      venture,
      website: hsCompany.website,
      linkedin_url: hsCompany.linkedinUrl,
      region,
      source: 'manual', // 'hubspot' no esta en el enum source — usamos manual + hubspot_id
      stage,
      hubspot_id: hsCompany.id,
      // Si HubSpot tiene num employees, podemos derivar locations_count (proxy laxo).
      // Lo dejamos null por ahora para no inventar data.
    } as never)
    .select('id')
    .single();

  if (error) {
    throw new Error(`insert company "${hsCompany.name}": ${error.message}`);
  }
  return (data as { id: string }).id;
}

async function insertContacts(
  db: DbClient,
  hsContacts: hubspot.HubspotContact[],
  companyId: string,
): Promise<number> {
  const rows = hsContacts
    .filter((c) => c.email || c.firstname || c.lastname)
    .map((c) => {
      const fullName = [c.firstname, c.lastname].filter(Boolean).join(' ').trim();
      return {
        company_id: companyId,
        hubspot_id: c.id,
        name: fullName || c.email || 'Sin nombre',
        role: c.jobTitle ?? null,
        email: c.email ?? null,
        linkedin_url: c.linkedinUrl ?? null,
        contact_source: 'HubSpot',
        is_decision_maker: false, // no tenemos forma confiable de inferirlo desde HubSpot
      };
    });

  if (rows.length === 0) return 0;

  const { error } = await db.from('contacts').insert(rows as never);
  if (error) {
    throw new Error(`insert contacts: ${error.message}`);
  }
  return rows.length;
}
