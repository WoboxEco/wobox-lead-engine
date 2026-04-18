import { env } from '@wobox/core';
import pRetry from 'p-retry';

// TODO: completar al implementar search-leads.
// Este stub documenta la shape esperada.

export interface ApolloSearchParams {
  keywords?: string;
  industries?: string[];
  locations?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  page?: number;
  perPage?: number;
}

export interface ApolloCompany {
  id: string;
  name: string;
  website_url?: string;
  linkedin_url?: string;
  estimated_num_employees?: number;
  industry?: string;
  city?: string;
  country?: string;
}

export async function searchOrganizations(_params: ApolloSearchParams): Promise<ApolloCompany[]> {
  const e = env();
  if (!e.APOLLO_API_KEY) {
    throw new Error('APOLLO_API_KEY not configured');
  }
  // TODO: POST {APOLLO_BASE_URL}/mixed_companies/search
  // Headers: { 'X-Api-Key': e.APOLLO_API_KEY }
  // Manejar rate limits + tracking de creditos en api_usage.
  throw new Error('searchOrganizations not yet implemented');
}

export async function getPeopleAtCompany(_apolloId: string): Promise<unknown[]> {
  // TODO: /mixed_people/search con organization_ids
  throw new Error('getPeopleAtCompany not yet implemented');
}

export async function _apolloFetch<T>(path: string, body: unknown): Promise<T> {
  const e = env();
  return pRetry(
    async () => {
      const res = await fetch(`${e.APOLLO_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': e.APOLLO_API_KEY ?? '',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Apollo ${path} returned ${res.status}`);
      }
      return (await res.json()) as T;
    },
    { retries: 3, minTimeout: 1000, factor: 2 },
  );
}
