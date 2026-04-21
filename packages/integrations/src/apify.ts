import { env } from '@wobox/core';
import pRetry from 'p-retry';

export interface GoogleMapsSearchParams {
  searchStringsArray: string[];
  locationQuery?: string;
  maxCrawledPlacesPerSearch?: number;
  language?: string;
  skipClosedPlaces?: boolean;
}

export interface MapsPlace {
  title: string;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  street?: string | null;
  website?: string | null;
  phone?: string | null;
  categoryName?: string | null;
  categories?: string[] | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  url?: string | null;
  placeId?: string | null;
  location?: { lat: number; lng: number } | null;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
}

export async function runGoogleMapsSearch(params: GoogleMapsSearchParams): Promise<MapsPlace[]> {
  const actor = env().APIFY_ACTOR_GOOGLE_MAPS;
  return _runActor<MapsPlace[]>(actor, {
    searchStringsArray: params.searchStringsArray,
    ...(params.locationQuery ? { locationQuery: params.locationQuery } : {}),
    maxCrawledPlacesPerSearch: params.maxCrawledPlacesPerSearch ?? 30,
    language: params.language ?? 'es',
    skipClosedPlaces: params.skipClosedPlaces ?? true,
    scrapePlaceDetailPage: false,
  });
}

export interface InstagramProfile {
  username: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  latestPosts?: Array<{ caption?: string; timestamp?: string }>;
}

export async function getInstagramProfile(_handle: string): Promise<InstagramProfile> {
  throw new Error('getInstagramProfile not yet implemented');
}

export async function _runActor<T>(actorId: string, input: unknown): Promise<T> {
  const e = env();
  if (!e.APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN not configured');
  }
  return pRetry(
    async () => {
      const url = `https://api.apify.com/v2/acts/${actorId.replace('/', '~')}/run-sync-get-dataset-items?token=${e.APIFY_API_TOKEN}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Apify ${actorId} returned ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    },
    { retries: 2, minTimeout: 3000, factor: 2 },
  );
}
