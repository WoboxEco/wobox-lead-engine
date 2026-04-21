import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { env } from './env.js';

export type DbClient = SupabaseClient<Database>;

let adminSingleton: DbClient | null = null;

export function createAdminClient(): DbClient {
  if (adminSingleton) return adminSingleton;
  const e = env();
  adminSingleton = createClient<Database>(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminSingleton;
}

export function createAnonClient(accessToken?: string): DbClient {
  const e = env();
  return createClient<Database>(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}
