import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireQuizUser } from '@/app/api/quiz/_shared/route-helpers';
import { verifyQuizAccessToken } from '@/lib/quiz/quiz-access-token';
import { createScopedClient } from '@/lib/supabase/scoped';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/api-auth', () => ({
  getBearerTokenFromRequest: (request: Request) => {
    const header = request.headers.get('Authorization') ?? '';
    return header.match(/^\s*bearer\s+(.+?)\s*$/i)?.[1]?.trim() || null;
  },
  hasBearerAuthScheme: (request: Request) =>
    /^\s*bearer(?:\s|$)/i.test(request.headers.get('Authorization') ?? ''),
}));

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
  },
}));

const USER_ID = 'user-1';

describe('quiz route mobile auth contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates bearer-token mobile requests with a locally verified token and a scoped client', async () => {
    const request = new NextRequest('http://localhost/api/quiz/events', {
      headers: { Authorization: 'Bearer mobile-token' },
    });
    const scopedSupabase = { rpc: vi.fn() };
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'verified',
      userId: USER_ID,
    });
    vi.mocked(createScopedClient).mockReturnValue(scopedSupabase as never);

    const result = await requireQuizUser(request);

    expect(result.response).toBeNull();
    expect(result.user).toEqual({ id: USER_ID });
    expect(result.supabase).toBe(scopedSupabase);
    expect(createScopedClient).toHaveBeenCalledWith('mobile-token');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects bearer-token mobile requests whose token fails local verification', async () => {
    const request = new NextRequest('http://localhost/api/quiz/events', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({ status: 'invalid' });

    const result = await requireQuizUser(request);

    expect(result.response?.status).toBe(401);
    expect(result.user).toBeNull();
    expect(result.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns 401 for cookie requests with no Supabase auth session', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'Auth session missing!', status: 400 },
    });
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await requireQuizUser(
      new NextRequest('http://localhost/api/quiz/events')
    );
    const body = await result.response?.json();

    expect(result.response?.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(result.user).toBeNull();
    expect(result.supabase).toBeNull();
    expect(getUser).toHaveBeenCalled();
  });

  it('returns 503 when Supabase auth lookup fails for a service reason', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'Supabase is unavailable', status: 503 },
    });
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser },
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await requireQuizUser(
      new NextRequest('http://localhost/api/quiz/events')
    );
    const body = await result.response?.json();

    expect(result.response?.status).toBe(503);
    expect(body).toEqual({
      code: 'auth_unavailable',
      error: 'Authentication lookup failed',
    });
    expect(result.user).toBeNull();
    expect(result.supabase).toBeNull();
    expect(getUser).toHaveBeenCalled();
  });
});
