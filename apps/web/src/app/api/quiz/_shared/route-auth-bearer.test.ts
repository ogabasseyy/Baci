import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { verifyQuizAccessToken } from '@/lib/quiz/quiz-access-token';
import { createAnonClient } from '@/lib/supabase/anon';
import { createScopedClient } from '@/lib/supabase/scoped';
import { createClient } from '@/lib/supabase/server';
import { requireQuizUser } from './route-auth';

// Bearer (mobile app) path of requireQuizUser. The cookie path and the static
// response helpers are covered in route-auth.test.ts.

vi.mock('@/lib/api-auth', () => ({
  getBearerTokenFromRequest: (request: Request) => {
    const header = request.headers.get('Authorization') ?? '';
    return header.match(/^\s*bearer\s+(.+?)\s*$/i)?.[1]?.trim() || null;
  },
  hasBearerAuthScheme: (request: Request) =>
    /^\s*bearer(?:\s|$)/i.test(request.headers.get('Authorization') ?? ''),
}));

// No shared store here: these tests cover this instance's own behaviour.
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/quiz/quiz-access-token', () => ({
  verifyQuizAccessToken: vi.fn(),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function readJson(response: Response) {
  return JSON.parse(await response.text());
}

describe('quiz route-auth bearer authentication', () => {
  const USER_UUID = '7d3f6a52-1b0e-4c53-9a43-0f6b1f0d2a11';
  const scoped = { from: vi.fn() };
  const getUser = vi.fn();

  function bearerRequest(scheme = 'Bearer') {
    return new NextRequest('http://localhost/api/quiz/events', {
      headers: { Authorization: `${scheme} token-123` },
    });
  }

  beforeEach(() => {
    getUser.mockReset();
    vi.mocked(createAnonClient).mockReturnValue({
      auth: { getUser },
    } as never);
    vi.mocked(createScopedClient).mockReturnValue(scoped as never);
  });

  it('verifies locally without calling Supabase Auth', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'verified',
      userId: USER_UUID,
    });

    const result = await requireQuizUser(bearerRequest());

    expect(result.response).toBeNull();
    expect(result).toMatchObject({ authMethod: 'bearer' });
    expect(result.user).toEqual({ id: USER_UUID });
    expect(result.supabase).toBe(scoped);
    expect(createScopedClient).toHaveBeenCalledWith('token-123');
    expect(getUser).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('accepts a lowercase authorization scheme', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'verified',
      userId: USER_UUID,
    });

    const result = await requireQuizUser(bearerRequest('bearer'));

    expect(result).toMatchObject({ authMethod: 'bearer', response: null });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects an empty bearer credential without falling back to cookies', async () => {
    const request = new NextRequest('http://localhost/api/quiz/events', {
      headers: { Authorization: 'Bearer   ' },
    });

    const result = await requireQuizUser(request);

    expect(result.response?.status).toBe(401);
    expect(verifyQuizAccessToken).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 401 for a locally invalid token without a network call', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'invalid',
    });

    const result = await requireQuizUser(bearerRequest());

    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
    expect(await readJson(result.response as Response)).toEqual({
      error: 'Unauthorized',
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('falls back to Supabase Auth when the token is unverifiable', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'unverifiable',
    });
    getUser.mockResolvedValue({
      data: { user: { id: USER_UUID } },
      error: null,
    });

    const result = await requireQuizUser(bearerRequest());

    expect(getUser).toHaveBeenCalledWith('token-123');
    expect(result.response).toBeNull();
    expect(result.user).toEqual({ id: USER_UUID });
    expect(result.supabase).toBe(scoped);
  });

  it('returns 401 when the network check rejects the token', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'unverifiable',
    });
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT', status: 401 },
    });

    const result = await requireQuizUser(bearerRequest());

    expect(result.response?.status).toBe(401);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['a 5xx response', { message: 'upstream down', status: 503 }],
    ['rate limiting', { message: 'too many requests', status: 429 }],
    ['a network failure', { message: 'fetch failed' }],
  ])('returns 503 auth_unavailable with Retry-After on %s', async (_label, error) => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'unverifiable',
    });
    getUser.mockResolvedValue({ data: { user: null }, error });

    const result = await requireQuizUser(bearerRequest());

    expect(result.response?.status).toBe(503);
    expect(result.response?.headers.get('Retry-After')).toBe('5');
    expect(await readJson(result.response as Response)).toEqual({
      code: 'auth_unavailable',
      error: 'Authentication lookup failed',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when the network check throws', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'unverifiable',
    });
    getUser.mockRejectedValue(new Error('socket hang up'));

    const result = await requireQuizUser(bearerRequest());

    expect(result.response?.status).toBe(503);
    expect(result.response?.headers.get('Retry-After')).toBe('5');
  });

  it('requireFreshSession always uses the network and skips local verification', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: USER_UUID } },
      error: null,
    });

    const result = await requireQuizUser(bearerRequest(), {
      requireFreshSession: true,
    });

    expect(verifyQuizAccessToken).not.toHaveBeenCalled();
    expect(getUser).toHaveBeenCalledWith('token-123');
    expect(result.user).toEqual({ id: USER_UUID });
  });

  it('requireFreshSession maps a revoked session to 401 and an outage to 503', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'session revoked', status: 403 },
    });
    const revoked = await requireQuizUser(bearerRequest(), {
      requireFreshSession: true,
    });
    expect(revoked.response?.status).toBe(401);

    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'timeout', status: 504 },
    });
    const outage = await requireQuizUser(bearerRequest(), {
      requireFreshSession: true,
    });
    expect(outage.response?.status).toBe(503);
  });

  it.each([
    ['a deleted user (404)', 404, 401],
    ['a malformed request (422)', 422, 401],
    ['a request timeout (408)', 408, 503],
    ['rate limiting (429)', 429, 503],
  ])('maps %s from Supabase Auth to %i -> %i', async (_label, status, expected) => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'auth error', status },
    });
    const result = await requireQuizUser(bearerRequest(), {
      requireFreshSession: true,
    });
    expect(result.response?.status).toBe(expected);
  });
});
