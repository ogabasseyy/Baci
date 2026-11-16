import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetSession = jest.fn<() => Promise<unknown>>();
const mockGetUser = jest.fn<(token?: string) => Promise<unknown>>();

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession, getUser: mockGetUser } },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Load the module under test via require (not a hoisted static import) so the
// jest.mock factories above capture the initialized mock fns — a static import
// is hoisted above the const declarations and would bind `undefined`. Matches
// the require() pattern in quiz.test.ts.
const { getQuizAuthHeaders } =
  require('./quiz-auth-headers') as typeof import('./quiz-auth-headers');
const { QuizServiceError } =
  require('./quiz-types') as typeof import('./quiz-types');

const withSession = (token: string, userId = 'user-1') => ({
  data: { session: { access_token: token, user: { id: userId } } },
  error: null,
});
const withoutSession = { data: { session: null }, error: null };

describe('getQuizAuthHeaders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns bearer headers and the user id from a single session read without a network getUser call', async () => {
    mockGetSession.mockResolvedValue(withSession('tok-1', 'user-1'));

    await expect(getQuizAuthHeaders()).resolves.toEqual({
      headers: { Authorization: 'Bearer tok-1' },
      userId: 'user-1',
    });
    // The server verifies the token; no Supabase Auth round trip per request.
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('retries once when the session has not hydrated yet, then succeeds', async () => {
    mockGetSession
      .mockResolvedValueOnce(withoutSession) // cold start: no token yet
      .mockResolvedValueOnce(withSession('tok-2', 'user-2')); // hydrated on retry

    await expect(getQuizAuthHeaders()).resolves.toMatchObject({
      userId: 'user-2',
    });
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it('throws QUIZ_AUTH_REQUIRED when no session appears after the retry', async () => {
    mockGetSession.mockResolvedValue(withoutSession);

    await expect(getQuizAuthHeaders()).rejects.toMatchObject({
      code: 'QUIZ_AUTH_REQUIRED',
      status: 401,
    });
    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('retries a transient getSession error, then succeeds', async () => {
    mockGetSession
      .mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'network blip' },
      })
      .mockResolvedValueOnce(withSession('tok-3', 'user-3'));

    await expect(getQuizAuthHeaders()).resolves.toMatchObject({
      userId: 'user-3',
    });
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it('does not retry a definitive auth error (401) and throws', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'jwt expired', status: 401 },
    });

    await expect(getQuizAuthHeaders()).rejects.toBeInstanceOf(QuizServiceError);
    // A definitive error (401 / expired jwt) must fail fast, not burn a retry.
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('throws QUIZ_AUTH_REQUIRED when the session has a token but no user id', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-x' } },
      error: null,
    });

    await expect(getQuizAuthHeaders()).rejects.toMatchObject({
      code: 'QUIZ_AUTH_REQUIRED',
      status: 401,
    });
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});
