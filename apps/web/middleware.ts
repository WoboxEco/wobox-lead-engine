import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRole, isAllowedEmail } from './lib/auth/whitelist';
import { updateSupabaseSession } from './lib/supabase/middleware';

// /api/cron: sin sesion (lo llama Vercel Cron); el route valida CRON_SECRET.
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout', '/auth/forbidden', '/api/cron'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user } = await updateSupabaseSession(request);

  if (isPublic(pathname)) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!isAllowedEmail(user.email)) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/forbidden';
    return NextResponse.redirect(url);
  }

  // sales: solo /crm (sus deals). El resto del Leads Engine queda para admin.
  if (getRole(user.email) === 'sales' && !pathname.startsWith('/crm')) {
    const url = request.nextUrl.clone();
    url.pathname = '/crm';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
