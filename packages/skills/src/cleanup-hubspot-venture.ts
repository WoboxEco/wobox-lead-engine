import { createAdminClient, createLogger } from '@wobox/core';

export interface CleanupHubspotVentureOptions {
  /**
   * Modo de cleanup:
   *  - all-to-loop: mueve TODAS las companies importadas de HubSpot que esten en wobox_food a loop.
   *  - surgical: solo las que matchean patterns gastronomicos (cocina, bar, parrilla, etc.) las mueve a loop.
   */
  mode?: string;
  /** No tocar la DB, solo loguear cuantas se moverian */
  dryRun?: boolean;
  /** Procesar solo N (debug) */
  limit?: string;
}

// Patterns gastronomicos / Loop. Si el nombre matchea cualquiera, es Loop.
const LOOP_NAME_PATTERNS = [
  // gastronomia
  'cafe',
  'café',
  'cafeteria',
  'cafetería',
  'bar ',
  ' bar',
  'parrilla',
  'pizzeria',
  'pizzería',
  'pizza',
  'panaderia',
  'panadería',
  'pasteleria',
  'pastelería',
  'patisserie',
  'pâtisserie',
  'heladeria',
  'heladería',
  'rotiseria',
  'rotisería',
  'sushi',
  'burger',
  'cocina',
  'resto',
  'restaurant',
  'bistro',
  'bistró',
  'almacen',
  'almacén',
  'dietetica',
  'dietética',
  'sandwich',
  'sándwich',
  'delivery',
  'pollos',
  'pollería',
  'polleria',
  'empanadas',
  'milanesa',
  'helados',
  'tea ',
  ' té ',
  'coffee',
  'food truck',
  'food bar',
  // wellness/loop
  'gym',
  'gimnasio',
  'crossfit',
  'pilates',
  'yoga',
  'spa',
  'studio',
  'estudio de',
  'wellness',
  'fitness',
  // belleza
  'peluqueria',
  'peluquería',
  'barber',
  'estetica',
  'estética',
  'manicure',
  'manicuría',
  'nail',
  'spa de',
];

export async function run(opts: CleanupHubspotVentureOptions): Promise<void> {
  const log = createLogger('cleanup-hubspot-venture');
  const db = createAdminClient();

  const mode = opts.mode ?? 'all-to-loop';
  if (mode !== 'all-to-loop' && mode !== 'surgical') {
    throw new Error(`mode invalido: "${mode}". Usar all-to-loop | surgical`);
  }
  const dryRun = !!opts.dryRun;
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : null;

  log.info({ mode, dryRun, limit }, 'starting cleanup');

  // Traer todas las companies en wobox_food que vinieron de HubSpot.
  // Supabase tiene un default cap de 1000 — paginamos para evitar truncado.
  const candidates: Array<{ id: string; name: string }> = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const to = from + PAGE - 1;
    const { data, error } = await db
      .from('companies')
      .select('id, name')
      .eq('venture', 'wobox_food')
      .not('hubspot_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`fetch companies: ${error.message}`);
    const batch = (data as Array<{ id: string; name: string }> | null) ?? [];
    candidates.push(...batch);
    if (batch.length < PAGE) break;
    if (limit && candidates.length >= limit) break;
    from += PAGE;
  }
  if (limit) candidates.length = Math.min(candidates.length, limit);
  console.log(`\nEncontradas ${candidates.length} companies en wobox_food con hubspot_id\n`);

  let toMove: Array<{ id: string; name: string }> = [];

  if (mode === 'all-to-loop') {
    toMove = candidates;
    console.log(`Mode all-to-loop: TODAS (${toMove.length}) se mueven a loop`);
  } else {
    // surgical
    toMove = candidates.filter((c) => {
      const lower = c.name.toLowerCase();
      return LOOP_NAME_PATTERNS.some((p) => lower.includes(p));
    });
    const stays = candidates.length - toMove.length;
    console.log(
      `Mode surgical: ${toMove.length} matchean patterns Loop, ${stays} quedan en wobox_food`,
    );
  }

  if (toMove.length === 0) {
    console.log('Nada que mover. Listo.');
    return;
  }

  // Sample para que el usuario vea
  console.log('\nSample (primeros 15):');
  for (const c of toMove.slice(0, 15)) console.log(`  - ${c.name}`);
  if (toMove.length > 15) console.log(`  ... +${toMove.length - 15} mas`);

  if (dryRun) {
    console.log('\n--dry-run: no se actualizo nada.');
    return;
  }

  // Bulk update en batches de 500 (Supabase no acepta updates muy grandes en un IN)
  const BATCH_SIZE = 500;
  let updated = 0;
  for (let i = 0; i < toMove.length; i += BATCH_SIZE) {
    const batch = toMove.slice(i, i + BATCH_SIZE);
    const ids = batch.map((c) => c.id);
    const { error: upErr } = await db
      .from('companies')
      .update({ venture: 'loop', updated_at: new Date().toISOString() })
      .in('id', ids);
    if (upErr) {
      log.error({ err: upErr.message, batchStart: i }, 'batch update fallo');
      throw new Error(`update batch ${i}: ${upErr.message}`);
    }
    updated += batch.length;
    console.log(`  batch ${i / BATCH_SIZE + 1}: ${batch.length} actualizadas (acum ${updated})`);
  }

  console.log(`\nDone: ${updated} companies movidas wobox_food -> loop`);
}
