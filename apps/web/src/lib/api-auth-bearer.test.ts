import { AuthSessionMissingError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => {
  const getUser = vi.fn();

  return {
    cookies: vi.fn(),
    createAnonClient: vi.fn(() => ({
      auth: { getUser },
    })),
    createClient: vi.fn(),
    createScopedClient: vi.fn((token: string) => ({ token })),
    getUser,
  };
});

vi.mock('next/headers', () => ({
  cookies: authMocks.cookies,
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: authMocks.createAnonClient,
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: authMocks.createScopedClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: authMocks.createClient,
}));

import {
  authenticateApiRequest,
  getBearerTokenFromRequest,
  hasBearerAuthScheme,
} from './api-auth';

describe('getBearerTokenFromRequest', () => {
  it('parses bearer authorization schemes case-insensitively', () => {
    expect(
      getBearerTokenFromRequest(
        new Request('https://example.com', {
          headers: { authorization: 'bearer mobile-token' },
        })
      )
    ).toBe('mobile-token');
    expect(
      getBearerTokenFromRequest(
        new Request('https://example.com', {
          headers: { authorization: 'Bearer mobile-token' },
        })
      )
    ).toBe('mobile-token');
  });

  it('rejects bearer headers without a token payload', () => {
    const request = new Request('https://example.com', {
      headers: { authorization: '  BeArEr   ' },
    });

    expect(hasBearerAuthScheme(request)).toBe(true);
    expect(getBearerTokenFromRequest(request)).toBeNull();
  });

  it('shares casing and leading-whitespace handling with scheme detection', () => {
    const request = new Request('https://example.com', {
      headers: { authorization: '  BeArEr   mobile-token  ' },
    });

    expect(hasBearerAuthScheme(request)).toBe(true);
    expect(getBearerTokenFromRequest(request)).toBe('mobile-token');
  });
});

describe('authenticateApiRequest', () => {
  beforeEach(() => {
    authMocks.cookies.mockReset();
    authMocks.createAnonClient.mockClear();
    authMocks.createClient.mockReset();
    authMocks.createScopedClient.mockClear();
    authMocks.getUser.mockReset();
  });

  it('authenticates lowercase bearer authorization as mobile token auth', async () => {
    authMocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const result = await authenticateApiRequest(
      new Request('https://example.com', {
        headers: { authorization: 'bearer mobile-token' },
      })
    );

    expect(result.error).toBeNull();
    expect(result.user).toEqual({ id: 'user-1' });
    expect(authMocks.getUser).toHaveBeenCalledWith('mobile-token');
    expect(authMocks.createScopedClient).toHaveBeenCalledWith('mobile-token');
    expect(authMocks.cookies).not.toHaveBeenCalled();
  });

  it('rejects an invalid lowercase bearer token without falling back to cookies', async () => {
    authMocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const result = await authenticateApiRequest(
      new Request('https://example.com', {
        headers: { authorization: 'bearer bad-token' },
      })
    );

    expect(result).toEqual({
      error: 'Invalid or expired token',
      supabase: null,
      user: null,
    });
    expect(authMocks.getUser).toHaveBeenCalledWith('bad-token');
    expect(authMocks.createScopedClient).not.toHaveBeenCalled();
    expect(authMocks.cookies).not.toHaveBeenCalled();
  });

  it('distinguishes a missing guest session from an authentication failure when asked', async () => {
    authMocks.cookies.mockResolvedValue({});
    authMocks.createClient.mockReturnValue({
      auth: { getUser: authMocks.getUser },
    });
    const request = new Request('https://example.com');

    authMocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    expect(
      await authenticateApiRequest(request, { requireVerifiedGuest: true })
    ).toMatchObject({
      user: null,
      error: 'Not authenticated',
    });

    authMocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('authentication service unavailable'),
    });
    expect(
      await authenticateApiRequest(request, { requireVerifiedGuest: true })
    ).toMatchObject({
      user: null,
      error: 'Authentication failed',
    });
  });

  it('does not downgrade a malformed bearer or an indeterminate empty result to a verified guest', async () => {
    const malformed = new Request('https://example.com', {
      headers: { authorization: 'Bearer ' },
    });
    expect(
      await authenticateApiRequest(malformed, { requireVerifiedGuest: true })
    ).toMatchObject({
      error: 'Invalid or expired token',
    });
    expect(authMocks.cookies).not.toHaveBeenCalled();

    authMocks.cookies.mockResolvedValue({});
    authMocks.createClient.mockReturnValue({
      auth: { getUser: authMocks.getUser },
    });
    authMocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(
      await authenticateApiRequest(new Request('https://example.com'), {
        requireVerifiedGuest: true,
      })
    ).toMatchObject({
      error: 'Authentication failed',
    });
  });
});
