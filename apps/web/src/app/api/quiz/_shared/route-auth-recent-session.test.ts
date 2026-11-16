import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { verifyQuizAccessToken } from '@/lib/quiz/quiz-access-token';
import { createAnonClient } from '@/lib/supabase/anon';
import { createScopedClient } from '@/lib/supabase/scoped';
import { resetRecentSessionChecksForTesting } from './quiz-session-recency';
import { requireQuizUser } from './route-auth';

// requireRecentSession: the answer route's bearer path. The token signature
// is verified on every request; the Supabase Auth session is asked about at
// most once a minute per token.

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
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn() }));
vi.mock('@/lib/supabase/scoped', () => ({ createScopedClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const USER_UUID = '7d3f6a52-1b0e-4c53-9a43-0f6b1f0d2a11';
const getUser = vi.fn();

function answerRequest(token = 'token-123') {
  return new NextRequest('http://localhost/api/quiz/attempts/a/answers', {
    headers: { Authorization: `Bearer ${token}` },
    method: 'POST',
  });
}

function sessionExists() {
  return { data: { user: { id: USER_UUID } }, error: null };
}

describe('quiz route-auth recent session check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRecentSessionChecksForTesting();
    getUser.mockReset();
    vi.mocked(createAnonClient).mockReturnValue({ auth: { getUser } } as never);
    vi.mocked(createScopedClient).mockReturnValue({ from: vi.fn() } as never);
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({
      status: 'verified',
      userId: USER_UUID,
    });
  });

  it('asks Supabase Auth once, then trusts the token for the next answers', async () => {
    getUser.mockResolvedValue(sessionExists());

    const first = await requireQuizUser(answerRequest(), {
      requireRecentSession: true,
    });
    const second = await requireQuizUser(answerRequest(), {
      requireRecentSession: true,
    });

    expect(first.user).toEqual({ id: USER_UUID });
    expect(second.user).toEqual({ id: USER_UUID });
    expect(getUser).toHaveBeenCalledTimes(1);
    // The signature is still verified on every request.
    expect(verifyQuizAccessToken).toHaveBeenCalledTimes(2);
  });

  it('refuses a signed-out or revoked session', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'session does not exist', status: 403 },
    });

    const result = await requireQuizUser(answerRequest(), {
      requireRecentSession: true,
    });

    expect(result.response?.status).toBe(401);
    expect(result.user).toBeNull();
  });

  it('checks each token on its own', async () => {
    getUser.mockResolvedValue(sessionExists());

    await requireQuizUser(answerRequest('token-a'), {
      requireRecentSession: true,
    });
    await requireQuizUser(answerRequest('token-b'), {
      requireRecentSession: true,
    });

    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('lets the answer through when Supabase Auth cannot answer, and asks again next time', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'upstream down', status: 503 },
    });
    getUser.mockResolvedValueOnce(sessionExists());

    const duringOutage = await requireQuizUser(answerRequest(), {
      requireRecentSession: true,
    });
    const afterOutage = await requireQuizUser(answerRequest(), {
      requireRecentSession: true,
    });

    expect(duringOutage.response).toBeNull();
    expect(duringOutage.user).toEqual({ id: USER_UUID });
    expect(afterOutage.user).toEqual({ id: USER_UUID });
    // The outage was not remembered as a successful check.
    expect(getUser).toHaveBeenCalledTimes(2);
    // Not logged per answer.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reuses the check made when the attempt was started', async () => {
    getUser.mockResolvedValue(sessionExists());

    await requireQuizUser(answerRequest(), { requireFreshSession: true });
    await requireQuizUser(answerRequest(), { requireRecentSession: true });

    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('still rejects a token with a bad signature without asking Supabase Auth', async () => {
    vi.mocked(verifyQuizAccessToken).mockResolvedValue({ status: 'invalid' });

    const result = await requireQuizUser(answerRequest(), {
      requireRecentSession: true,
    });

    expect(result.response?.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('does not check the session on read routes', async () => {
    const result = await requireQuizUser(answerRequest());

    expect(result.user).toEqual({ id: USER_UUID });
    expect(getUser).not.toHaveBeenCalled();
  });
});
