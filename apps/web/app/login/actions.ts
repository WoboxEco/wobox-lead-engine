'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';

export async function signInWithGoogle() {
  const supabase = await createSupabaseServerClient();
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protoHeader = headerList.get('x-forwarded-proto');
  const proto = protoHeader ?? (host.startsWith('localhost') ? 'http' : 'https');
  const base = `${proto}://${host}`;
  const redirectTo = `${base}/auth/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  if (error) throw new Error(error.message);
  redirect(data.url);
}
