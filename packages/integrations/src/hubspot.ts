import { type Venture, env } from '@wobox/core';
import pRetry from 'p-retry';

const BASE = 'https://api.hubapi.com';

// Stage ID del pipeline "default" de Wobox donde aterrizan los meeting_booked.
export const DEAL_STAGE_CONTACTO = 'appointmentscheduled';
export const DEAL_PIPELINE_DEFAULT = 'default';
export const DEAL_STAGES = {
  sin_contacto: '1120078995',
  contacto: 'appointmentscheduled',
  presentacion: 'presentationscheduled',
  negociacion: 'decisionmakerboughtin',
  onboarding: 'contractsent',
  ganado: 'closedwon',
  perdido: 'closedlost',
} as const;

export interface CreateDealParams {
  name: string;
  venture: Venture;
  companyName: string;
  contactEmail?: string;
  pipeline?: string;
  stageId?: string;
  amount?: number;
}

export async function createDeal(params: CreateDealParams): Promise<{ id: string }> {
  const payload = {
    properties: {
      dealname: params.name,
      pipeline: params.pipeline ?? DEAL_PIPELINE_DEFAULT,
      dealstage: params.stageId ?? DEAL_STAGE_CONTACTO,
      venture: params.venture,
      ...(params.amount !== undefined ? { amount: String(params.amount) } : {}),
    },
  };
  const res = await _hubspotFetch<{ id: string }>('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: res.id };
}

export async function associateDealToContact(dealId: string, contactId: string): Promise<void> {
  await _hubspotFetch(
    `/crm/v4/objects/deals/${dealId}/associations/default/contacts/${contactId}`,
    { method: 'PUT' },
  );
}

export async function upsertContactByEmail(params: {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  companyName?: string;
}): Promise<{ id: string }> {
  // Buscar por email.
  const searchRes = await _hubspotFetch<{ results: Array<{ id: string }> }>(
    '/crm/v3/objects/contacts/search',
    {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: 'email', operator: 'EQ', value: params.email.toLowerCase() }],
          },
        ],
        limit: 1,
      }),
    },
  );
  if (searchRes.results[0]) return { id: searchRes.results[0].id };

  // Crear si no existe.
  const create = await _hubspotFetch<{ id: string }>('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        email: params.email,
        ...(params.firstname ? { firstname: params.firstname } : {}),
        ...(params.lastname ? { lastname: params.lastname } : {}),
        ...(params.phone ? { phone: params.phone } : {}),
        ...(params.companyName ? { company: params.companyName } : {}),
      },
    }),
  });
  return { id: create.id };
}

export interface ClosedDeal {
  id: string;
  status: 'won' | 'lost';
  closedAt: string;
  ventureValue: Venture | null;
}

export async function getClosedDeals(since: Date): Promise<ClosedDeal[]> {
  const sinceMs = since.getTime();
  const res = await _hubspotFetch<{
    results: Array<{
      id: string;
      properties: {
        dealstage: string;
        venture?: string | null;
        closedate?: string | null;
        hs_lastmodifieddate?: string | null;
      };
    }>;
  }>('/crm/v3/objects/deals/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: 'dealstage', operator: 'IN', values: ['closedwon', 'closedlost'] },
            { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(sinceMs) },
          ],
        },
      ],
      properties: ['dealstage', 'venture', 'closedate', 'hs_lastmodifieddate'],
      limit: 100,
    }),
  });

  return res.results.map((d) => ({
    id: d.id,
    status: d.properties.dealstage === 'closedwon' ? 'won' : 'lost',
    closedAt:
      d.properties.closedate ?? d.properties.hs_lastmodifieddate ?? new Date().toISOString(),
    ventureValue: (d.properties.venture as Venture | undefined) ?? null,
  }));
}

export async function _hubspotFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const e = env();
  if (!e.HUBSPOT_PRIVATE_APP_TOKEN) {
    throw new Error('HUBSPOT_PRIVATE_APP_TOKEN not configured');
  }
  return pRetry(
    async () => {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${e.HUBSPOT_PRIVATE_APP_TOKEN}`,
          ...init.headers,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HubSpot ${path} returned ${res.status}: ${text.slice(0, 400)}`);
      }
      if (res.status === 204) return {} as T;
      return (await res.json()) as T;
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );
}
