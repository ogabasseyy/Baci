// @vitest-environment node
import type { CookieOptions } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { updateSession } from './middleware';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://synthetic.supabase.co',
  getSupabaseAnonKey: () => 'synthetic-anon',
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: create }));
it('refreshes the incoming request and preserves lax secure browser cookies', async () => {
  create.mockImplementation(
    (
      _url: string,
      _key: string,
      options: {
        cookieOptions: CookieOptions;
        cookies: {
          setAll: (
            cookies: { name: string; value: string; options: CookieOptions }[]
          ) => void;
        };
      }
    ) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            {
              name: 'sb-synthetic-auth-token',
              value: 'synthetic-session',
              options: { ...options.cookieOptions, path: '/' },
            },
          ]);
          return { data: { user: { id: 'actor' } } };
        },
      },
    })
  );
  const request = new NextRequest('https://usebaci.com/dashboard');
  const result = await updateSession(request);
  expect(request.cookies.get('sb-synthetic-auth-token')?.value).toBe(
    'synthetic-session'
  );
  expect(result.user?.id).toBe('actor');
  const cookie = result.supabaseResponse.headers.getSetCookie().join(';');
  expect(cookie).toMatch(/samesite=lax/i);
  expect(cookie).toContain('Secure');
});
