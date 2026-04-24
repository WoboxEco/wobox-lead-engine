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
  externalUrl?: string;
  latestPosts?: Array<{ caption?: string; timestamp?: string }>;
}

export async function getInstagramProfile(handle: string): Promise<InstagramProfile | null> {
  const results = await getInstagramProfiles([handle]);
  return results[0] ?? null;
}

export async function getInstagramProfiles(handles: string[]): Promise<InstagramProfile[]> {
  const clean = handles
    .map((h) => normalizeInstagramHandle(h))
    .filter((h): h is string => Boolean(h));
  if (clean.length === 0) return [];

  const actor = env().APIFY_ACTOR_INSTAGRAM;
  const raw = await _runActor<RawInstagramProfile[]>(actor, {
    usernames: clean,
    resultsLimit: 1,
  });

  return raw.map((r) => ({
    username: r.username,
    ...(r.fullName ? { fullName: r.fullName } : {}),
    ...(r.biography ? { biography: r.biography } : {}),
    ...(typeof r.followersCount === 'number' ? { followersCount: r.followersCount } : {}),
    ...(typeof r.followsCount === 'number' ? { followsCount: r.followsCount } : {}),
    ...(typeof r.postsCount === 'number' ? { postsCount: r.postsCount } : {}),
    ...(r.externalUrl ? { externalUrl: r.externalUrl } : {}),
    ...(Array.isArray(r.latestPosts)
      ? {
          latestPosts: r.latestPosts.slice(0, 5).map((p) => ({
            ...(p.caption ? { caption: p.caption } : {}),
            ...(p.timestamp ? { timestamp: p.timestamp } : {}),
          })),
        }
      : {}),
  }));
}

interface RawInstagramProfile {
  username: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  externalUrl?: string;
  latestPosts?: Array<{ caption?: string; timestamp?: string }>;
}

export function normalizeInstagramHandle(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // URL forms: instagram.com/handle, instagram.com/handle/, @handle
  const urlMatch = trimmed.match(/instagram\.com\/([^/?#]+)/i);
  if (urlMatch?.[1]) {
    const cand = urlMatch[1].replace(/^@/, '');
    if (/^[a-z0-9._]+$/i.test(cand)) return cand.toLowerCase();
    return null;
  }

  const bare = trimmed.replace(/^@/, '');
  if (/^[a-z0-9._]+$/i.test(bare)) return bare.toLowerCase();
  return null;
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
