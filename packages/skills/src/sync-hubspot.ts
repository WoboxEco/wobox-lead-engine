import {
  type DbClient,
  type Venture,
  createAdminClient,
  createLogger,
  writeErrorLog,
} from '@wobox/core';
import { hubspot } from '@wobox/integrations';

export interface SyncHubspotOptions {
  direction?: 'push' | 'pull' | 'both';
  sinceDays?: string;
}

export async function run(opts: SyncHubspotOptions): Promise<void> {
  const log = createLogger('sync-hubspot');
  const db = createAdminClient();
  const direction = opts.direction ?? 'both';
  const sinceDays = Number.parseInt(opts.sinceDays ?? '7', 10);

  if (direction === 'push' || direction === 'both') {
    await pushMeetingBooked(db, log);
  }
  if (direction === 'pull' || direction === 'both') {
    await pullClosedDeals(db, log, sinceDays);
  }
}

async function pushMeetingBooked(
  db: DbClient,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const { data, error } = await db
    .from('companies')
    .select('id, name, venture, contacts(id, name, email)')
    .eq('stage', 'meeting_booked')
    .is('hubspot_deal_id', null);

  if (error) throw new Error(`fetch companies: ${error.message}`);

  type Row = {
    id: string;
    name: string;
    venture: Venture;
    contacts: Array<{ id: string; name: string | null; email: string | null }>;
  };
  const pending = (data as unknown as Row[]) ?? [];

  if (pending.length === 0) {
    log.info('no hay companies pending para pushear');
    return;
  }

  log.info({ pending: pending.length }, 'pusheando a HubSpot');

  let ok = 0;
  let failed = 0;

  for (const c of pending) {
    try {
      const contactWithEmail = c.contacts.find((ct) => ct.email);

      const deal = await hubspot.createDeal({
        name: `${c.name} (${c.venture})`,
        venture: c.venture,
        companyName: c.name,
        ...(contactWithEmail?.email ? { contactEmail: contactWithEmail.email } : {}),
      });

      let hubspotContactId: string | null = null;
      if (contactWithEmail?.email) {
        const [firstname, ...rest] = (contactWithEmail.name ?? '').split(' ');
        const hubContact = await hubspot.upsertContactByEmail({
          email: contactWithEmail.email,
          ...(firstname ? { firstname } : {}),
          ...(rest.length > 0 ? { lastname: rest.join(' ') } : {}),
          companyName: c.name,
        });
        hubspotContactId = hubContact.id;
        await hubspot.associateDealToContact(deal.id, hubContact.id);
      }

      const { error: updateErr } = await db
        .from('companies')
        .update({
          hubspot_deal_id: deal.id,
          ...(hubspotContactId ? { hubspot_id: hubspotContactId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', c.id);
      if (updateErr) throw new Error(`update company: ${updateErr.message}`);

      await db.from('api_usage').insert({
        service: 'hubspot',
        operation: 'create-deal',
        credits_used: 1,
        venture: c.venture,
      });

      log.info({ company: c.name, dealId: deal.id }, 'deal creado en HubSpot');
      ok += 1;
    } catch (err) {
      failed += 1;
      log.error({ err, companyId: c.id }, 'push failed');
      await writeErrorLog(db, {
        skill: 'sync-hubspot',
        error: err,
        companyId: c.id,
        context: { direction: 'push' },
      });
    }
  }

  log.info({ ok, failed }, 'push done');
}

async function pullClosedDeals(
  db: DbClient,
  log: ReturnType<typeof createLogger>,
  sinceDays: number,
): Promise<void> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const deals = await hubspot.getClosedDeals(since);

  if (deals.length === 0) {
    log.info({ sinceDays }, 'no closed deals en ventana');
    return;
  }

  log.info({ count: deals.length, sinceDays }, 'pulling closed deals');

  let updated = 0;

  for (const d of deals) {
    const { data: company } = await db
      .from('companies')
      .select('id, name, stage')
      .eq('hubspot_deal_id', d.id)
      .maybeSingle();

    if (!company) {
      log.warn({ dealId: d.id }, 'no hay company matcheada con este deal');
      continue;
    }

    const row = company as { id: string; name: string; stage: string };
    // No cambiamos stage en Supabase; mantenemos meeting_booked como ultimo estado
    // conocido. El flywheel consulta interactions + api_usage para cruzar con HubSpot.
    await db.from('interactions').insert({
      company_id: row.id,
      type: 'meeting',
      channel: 'in_person',
      content: `HubSpot deal ${d.id} → ${d.status}`,
      outcome: d.status === 'won' ? 'accepted' : 'declined',
      ai_generated: false,
      performed_at: d.closedAt,
    });

    updated += 1;
  }

  log.info({ updated, total: deals.length }, 'pull done');
}
