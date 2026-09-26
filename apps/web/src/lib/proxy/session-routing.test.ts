import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }));

import { updateSession } from '@/lib/supabase/middleware';
import {
  isSessionRoutingEligible,
  runSessionRoutingStage,
} from './session-routing';

const AUTHENTICATED_USER: User = {
  app_metadata: {},
  aud: 'authenticated',
  created_at: '2026-09-26T00:00:00.000Z',
  id: 'user-id',
  user_metadata: {},
};

function createSupabaseResponseWithCookie(
  name: string,
  value: string,
  maxAge: number
): NextResponse {
  const response = NextResponse.next();
  response.cookies.set(name, value, {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
  return response;
}

describe('session routing', () => {
  it('recognizes only auth and protected dashboard routes', () => {
    expect(isSessionRoutingEligible('/dashboard/orders')).toBe(true);
    expect(isSessionRoutingEligible('/products/iphone')).toBe(false);
  });

  it('redirects an unauthenticated protected route with its internal destination', async () => {
    vi.mocked(updateSession).mockResolvedValue({
      supabaseResponse: NextResponse.next(),
      user: null,
    });
    const response = await runSessionRoutingStage(
      new NextRequest('https://usebaci.com/dashboard/orders?tab=open'),
      '/dashboard/orders',
      'usebaci.com',
      'Mozilla'
    );
    expect(response?.headers.get('location')).toBe(
      'https://usebaci.com/login?redirect=%2Fdashboard%2Forders%3Ftab%3Dopen'
    );
  });

  it('keeps Supabase clear-cookie attributes on an unauthenticated protected redirect', async () => {
    vi.mocked(updateSession).mockResolvedValue({
      supabaseResponse: createSupabaseResponseWithCookie(
        'sb-access-token',
        '',
        0
      ),
      user: null,
    });

    const response = await runSessionRoutingStage(
      new NextRequest('https://usebaci.com/dashboard/orders'),
      '/dashboard/orders',
      'usebaci.com',
      'Mozilla'
    );

    expect(response?.headers.get('location')).toBe(
      'https://usebaci.com/login?redirect=%2Fdashboard%2Forders'
    );
    expect(response?.cookies.get('sb-access-token')).toMatchObject({
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: true,
      value: '',
    });
  });

  it('keeps Supabase refreshed-cookie attributes on an authenticated login redirect', async () => {
    vi.mocked(updateSession).mockResolvedValue({
      supabaseResponse: createSupabaseResponseWithCookie(
        'sb-refresh-token',
        'refreshed-value',
        3600
      ),
      user: AUTHENTICATED_USER,
    });

    const response = await runSessionRoutingStage(
      new NextRequest('https://usebaci.com/login?redirect=%2Fdashboard'),
      '/login',
      'usebaci.com',
      'Mozilla'
    );

    expect(response?.headers.get('location')).toBe(
      'https://usebaci.com/dashboard'
    );
    expect(response?.cookies.get('sb-refresh-token')).toMatchObject({
      httpOnly: true,
      maxAge: 3600,
      path: '/',
      sameSite: 'lax',
      secure: true,
      value: 'refreshed-value',
    });
  });
});
