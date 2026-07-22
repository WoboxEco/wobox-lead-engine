import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRole, isAllowedEmail } from '../../../lib/auth/whitelist';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? 'session_failed')}`, url.origin),
    );
  }

  if (!isAllowedEmail(data.session.user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/auth/forbidden', url.origin));
  }

  const landing = getRole(data.session.user.email) === 'sales' ? '/crm' : '/';
  return NextResponse.redirect(new URL(landing, url.origin));
}
