import { env } from '@wobox/core';
import pRetry from 'p-retry';

// Apify clients para Google Maps (crawler-google-places) e Instagram (instagram-profile-scraper).
// TODO: implementar en search-leads-web y enrich-lead.

export interface GoogleMapsSearchParams {
  searchStringsArray: string[];
  locationQuery?: string;
  maxCrawledPlacesPerSearch?: number;
  language?: string;
}

export interface MapsPlace {
  title: string;
  address?: string;
  website?: string;
  phone?: string;
  categoryName?: string;
  totalScore?: number;
  reviewsCount?: number;
  location?: { lat: number; lng: number };
}

export async function runGoogleMapsSearch(_params: GoogleMapsSearchParams): Promise<MapsPlace[]> {
  throw new Error('runGoogleMapsSearch not yet implemented');
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
      const res = await fetch(
        `https://api.apify.com/v2/acts/${actorId.replace('/', '~')}/run-sync-get-dataset-items?token=${e.APIFY_API_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) {
        throw new Error(`Apify ${actorId} returned ${res.status}`);
      }
      return (await res.json()) as T;
    },
    { retries: 3, minTimeout: 2000, factor: 2 },
  );
}
