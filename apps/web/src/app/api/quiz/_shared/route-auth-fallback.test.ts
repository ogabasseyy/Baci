import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyQuizAccessToken } from '@/lib/quiz/quiz-access-token';
import { createAnonClient } from '@/lib/supabase/anon';
import { createScopedClient } from '@/lib/supabase/scoped';
import {
  FALLBACK_MAX_PER_WINDOW,
  resetAuthFallbackBudgetForTesting,
} from './quiz-auth-fallback-budget';
import { requireQuizUser } from './route-auth';

// What requireQuizUser does with tokens it cannot trust on sight: a provably
// bad token never reaches Supabase Auth, an unverifiable one does only within
// the instance budget, and a route that must fail closed does not hang.

vi.mock('@/lib/api-auth', () => ({
  getBearerTokenFromRequest: (request: Request) => {
    const header = request.headers.get('Authorization') ?? '';
    return header.match(/^\s*bearer\s+(.+?)\s*$/i)?.[1]?.trim() || null;
  },
  hasBearerAuthScheme: (request: Request) =>
    /^\s*bearer(?:\s|$)/i.test(request.headers.get('Authorization') ?? ''),
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/quiz/quiz-access-token', () => ({
  verifyQuizAccessToken: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn() }));
vi.mock('@/lib/supabase/scoped', () => ({ createScopedClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const USER_UUID = '7d3f6a52-1b0e-4c53-9a43-0f6b1f0d2a11';
const getUser = vi.fn();

function startRequest() {
  return new NextRequest('http://localhost/api/quiz/attempts/start', {
    headers: { Authorization: 'Bearer token-123' },
    method: 'POST',
  });
}

describe('quiz route-auth with untrusted tokens', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthFallbackBudgetForTesting();
    getUser.mockReset();
    getUser.mockResolvedValue({
      data: { user: { id: USER_UUID } },
      error: null,
    });
    vi.mocked(createAnonClient).mockReturnValue({ auth: { getUser } } as never);
    vi.mocked(createScopedClient).mockReturnValue({ from: vi.fn() } as never);
  });

  it('refuses a provably bad token on a fresh-session route without asking Supabase Auth', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({ status: 'invalid' });

    const result = await requireQuizUser(startRequest(), {
      requireFreshSession: true,
    });

    expect(result.response?.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('stops passing unverifiable tokens to Supabase Auth once the budget is spent', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'unverifiable',
    });

    for (let call = 0; call < FALLBACK_MAX_PER_WINDOW; call += 1) {
      const allowed = await requireQuizUser(startRequest());
      expect(allowed.user).toEqual({ id: USER_UUID });
    }
    const refused = await requireQuizUser(startRequest(), {
      requireFreshSession: true,
    });

    expect(refused.response?.status).toBe(503);
    expect(refused.response?.headers.get('Retry-After')).toBe('5');
    expect(getUser).toHaveBeenCalledTimes(FALLBACK_MAX_PER_WINDOW);
  });

  it('does not spend the budget on tokens it verified itself', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'verified',
      userId: USER_UUID,
    });

    for (let call = 0; call <= FALLBACK_MAX_PER_WINDOW; call += 1) {
      const result = await requireQuizUser(startRequest(), {
        requireFreshSession: true,
      });
      expect(result.user).toEqual({ id: USER_UUID });
    }
  });

  it('answers 503 when Supabase Auth takes more than four seconds on a fresh-session route', async () => {
    vi.useFakeTimers();
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'verified',
      userId: USER_UUID,
    });
    getUser.mockReturnValue(new Promise(() => undefined)); // never answers

    const pending = requireQuizUser(startRequest(), {
      requireFreshSession: true,
    });
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await pending;

    expect(result.response?.status).toBe(503);
    expect(result.user).toBeNull();
  });
});
