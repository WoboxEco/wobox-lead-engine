'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

const THEME_COOKIE = 'wobox_theme';

export type Theme = 'dark' | 'light';

export async function toggleTheme(): Promise<void> {
  const store = await cookies();
  const current = store.get(THEME_COOKIE)?.value === 'light' ? 'light' : 'dark';
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  store.set(THEME_COOKIE, next, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 anio
    sameSite: 'lax',
  });
  revalidatePath('/');
}

export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  return store.get(THEME_COOKIE)?.value === 'light' ? 'light' : 'dark';
}
