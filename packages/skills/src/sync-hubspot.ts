import { createLogger } from '@wobox/core';

export async function run(): Promise<void> {
  const log = createLogger('sync-hubspot');
  log.warn('stub: implement bidirectional HubSpot sync');
  // TODO:
  // Push: companies con stage=meeting_booked y hubspot_deal_id=null -> createDeal -> guardar hubspot_deal_id.
  // Pull: getClosedDeals(since=last_sync) -> actualizar companies y alimentar flywheel.
}
