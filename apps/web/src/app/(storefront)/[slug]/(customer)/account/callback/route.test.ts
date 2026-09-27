import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCookies, mockCreateClient, mockExchangeCodeForSession } =
  vi.hoisted(() => ({
    mockCookies: vi.fn(),
    mockCreateClient: vi.fn(),
    mockExchangeCodeForSession: vi.fn(),
  }));

vi.mock('next/headers', () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

import { GET } from './route';

const ORIGIN = 'https://ogabassey.com';

function request(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

function locationOf(response: Response): string {
  expect(response.status).toBe(307);
  const location = response.headers.get('Location');
  expect(location).not.toBeNull();
  return location as string;
}

describe('GET [slug]/(customer)/account/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: vi.fn() });
    mockCreateClient.mockReturnValue({
      auth: { exchangeCodeForSession: mockExchangeCodeForSession },
    });
  });

  it('redirects a provider error to the slug login page with the message', async () => {
    const response = await GET(
      request(
        '/ogabassey/account/callback?error=access_denied&error_description=Denied+by+user'
      ),
      { params: Promise.resolve({ slug: 'ogabassey' }) }
    );

    expect(locationOf(response)).toBe(
      `${ORIGIN}/ogabassey/account/login?error=${encodeURIComponent('Denied by user')}`
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('redirects to the slug login page when no code is provided', async () => {
    const response = await GET(request('/ogabassey/account/callback'), {
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(locationOf(response)).toBe(
      `${ORIGIN}/ogabassey/account/login?error=No%20authorization%20code%20provided`
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('redirects to the slug account page after a successful exchange', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const response = await GET(
      request('/ogabassey/account/callback?code=auth-code'),
      { params: Promise.resolve({ slug: 'ogabassey' }) }
    );

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('auth-code');
    expect(locationOf(response)).toBe(`${ORIGIN}/ogabassey/account`);
  });

  it('redirects to login with the exchange failure message', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: 'code expired' },
    });

    const response = await GET(
      request('/ogabassey/account/callback?code=stale-code'),
      { params: Promise.resolve({ slug: 'ogabassey' }) }
    );

    expect(locationOf(response)).toBe(
      `${ORIGIN}/ogabassey/account/login?error=${encodeURIComponent('code expired')}`
    );
  });

  it('redirects to login with a generic message on unexpected errors', async () => {
    mockExchangeCodeForSession.mockRejectedValue(new Error('network down'));

    const response = await GET(
      request('/ogabassey/account/callback?code=auth-code'),
      { params: Promise.resolve({ slug: 'ogabassey' }) }
    );

    expect(locationOf(response)).toBe(
      `${ORIGIN}/ogabassey/account/login?error=An%20unexpected%20error%20occurred`
    );
  });
});
