import { type Venture, env } from '@wobox/core';
import pRetry from 'p-retry';

// HubSpot Private App. Mapping de stages de spec:
// sin contacto -> contacto -> presentacion -> negociacion -> onboarding -> cierre ganado/perdido
// Custom property "venture" (single-select) debe existir en HubSpot antes del primer sync.

export interface HubSpotDealPayload {
  name: string;
  venture: Venture;
  companyName: string;
  contactEmail?: string;
  amount?: number;
}

export async function createDeal(_payload: HubSpotDealPayload): Promise<{ id: string }> {
  throw new Error('createDeal not yet implemented');
}

export async function getClosedDeals(
  _since: Date,
): Promise<Array<{ id: string; status: 'won' | 'lost' }>> {
  throw new Error('getClosedDeals not yet implemented');
}

export async function _hubspotFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const e = env();
  if (!e.HUBSPOT_PRIVATE_APP_TOKEN) {
    throw new Error('HUBSPOT_PRIVATE_APP_TOKEN not configured');
  }
  return pRetry(
    async () => {
      const res = await fetch(`https://api.hubapi.com${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${e.HUBSPOT_PRIVATE_APP_TOKEN}`,
          ...init?.headers,
        },
      });
      if (!res.ok) {
        throw new Error(`HubSpot ${path} returned ${res.status}`);
      }
      return (await res.json()) as T;
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );
}
