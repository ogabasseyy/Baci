import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExchangeCodeForSession } = vi.hoisted(() => ({
  mockExchangeCodeForSession: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    has: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  })),
}));

import { GET } from './route';

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the guest session hint cookie when code exchange succeeds', async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/callback?code=abc&next=/ogabassey/account'
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/ogabassey/account'
    );
    expect(response.headers.get('set-cookie')).toContain(
      'baci_customer_session_hint=;'
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('redirects to /login on missing or failed code exchange', async () => {
    const response = await GET(
      new Request('https://usebaci.com/auth/callback')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/login?error=Could%20not%20authenticate%20user'
    );
  });
});
