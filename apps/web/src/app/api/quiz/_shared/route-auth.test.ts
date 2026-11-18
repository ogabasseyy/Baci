import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import {
  invalidInputResponse,
  quizRpcClientErrorResponse,
  requireQuizUser,
  rpcErrorResponse,
} from './route-auth';

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

const ORIGINAL_ENV = process.env;
const USER_ID = 'user-1';

function mockSupabase({
  authError = null,
  user = { id: USER_ID },
}: {
  authError?: unknown;
  user?: { id: string } | null;
} = {}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }),
    },
  };
  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return { supabase };
}

async function readJson(response: Response) {
  return JSON.parse(await response.text());
}

describe('quiz route-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  describe('requireQuizUser', () => {
    it('returns the user when authenticated', async () => {
      mockSupabase({ user: { id: USER_ID } });

      const result = await requireQuizUser();

      expect(result.response).toBeNull();
      expect(result.user).toEqual({ id: USER_ID });
      expect(result).toMatchObject({ authMethod: 'cookie' });
    });

    it('returns a 401 response when unauthenticated', async () => {
      mockSupabase({ user: null });

      const result = await requireQuizUser();

      expect(result.user).toBeNull();
      expect(result.supabase).toBeNull();
      expect(result.response?.status).toBe(401);
      expect(await readJson(result.response as Response)).toEqual({
        error: 'Unauthorized',
      });
    });

    it('logs only safe auth lookup error fields', async () => {
      mockSupabase({
        authError: {
          code: 'auth_lookup_failed',
          message: 'lookup failed',
          status: 500,
          token: 'secret-token',
        },
        user: null,
      });

      const result = await requireQuizUser();

      expect(result.response?.status).toBe(503);
      expect(result.response?.headers.get('Retry-After')).toBe('5');
      expect(await readJson(result.response as Response)).toEqual({
        code: 'auth_unavailable',
        error: 'Authentication lookup failed',
      });
      expect(logger.error).toHaveBeenCalledWith({
        errorCode: 'auth_lookup_failed',
        errorMessage: 'lookup failed',
        errorStatus: 500,
        message: 'Quiz auth lookup failed',
      });
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
        'secret-token'
      );
    });

    it('returns a 401 when the auth session is missing without logging', async () => {
      mockSupabase({
        authError: { message: 'Auth session missing!' },
        user: null,
      });

      const result = await requireQuizUser();

      expect(result.response?.status).toBe(401);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('static response helpers', () => {
    it('invalidInputResponse returns 400 with details', async () => {
      const response = invalidInputResponse({ field: ['required'] });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        details: { field: ['required'] },
        error: 'Invalid input',
      });
    });

    it('rpcErrorResponse returns 500', async () => {
      const response = rpcErrorResponse();

      expect(response.status).toBe(500);
      expect(await readJson(response)).toEqual({
        error: 'Quiz request failed',
      });
    });

    it('quizRpcClientErrorResponse maps expected quiz business-state codes', async () => {
      const response = quizRpcClientErrorResponse({
        code: 'QZ023',
        message: 'quiz_grand_award_not_found',
      });

      expect(response?.status).toBe(409);
      expect(await readJson(response as Response)).toEqual({
        code: 'QUIZ_GRAND_AWARD_NOT_CLAIMABLE',
        error: 'No approved grand prize is available to claim',
      });
    });

    it('quizRpcClientErrorResponse maps the attempt-limit code (QZ030) to a friendly 409', async () => {
      const response = quizRpcClientErrorResponse({
        code: 'QZ030',
        message: 'attempt_limit_reached',
      });

      expect(response?.status).toBe(409);
      expect(await readJson(response as Response)).toEqual({
        code: 'QUIZ_ATTEMPT_LIMIT_REACHED',
        error: "You've reached the maximum number of attempts for this quiz.",
      });
    });

    it('quizRpcClientErrorResponse maps the device-limit code (QZ041) to a friendly 409', async () => {
      const response = quizRpcClientErrorResponse({
        code: 'QZ041',
        message: 'quiz_device_attempt_limit',
      });

      expect(response?.status).toBe(409);
      expect(await readJson(response as Response)).toEqual({
        code: 'QUIZ_ATTEMPT_LIMIT_REACHED',
        error: "You've reached the maximum number of attempts for this quiz.",
      });
    });

    it('quizRpcClientErrorResponse tells the app when to retry a busy database', async () => {
      const response = quizRpcClientErrorResponse({ code: '55P03' });

      expect(response?.status).toBe(503);
      expect(response?.headers.get('Retry-After')).toBe('2');
      expect(await readJson(response as Response)).toEqual({
        code: 'QUIZ_BUSY',
        error: 'The quiz is busy. Please try again.',
      });
    });

    it('quizRpcClientErrorResponse maps the leaderboard-authz code (QZ031) to a 403', async () => {
      const response = quizRpcClientErrorResponse({
        code: 'QZ031',
        message: 'not_authorized',
      });

      expect(response?.status).toBe(403);
      expect(await readJson(response as Response)).toEqual({
        code: 'QUIZ_LEADERBOARD_NOT_AUTHORIZED',
        error: 'You are not authorized to view this leaderboard',
      });
    });

    it('quizRpcClientErrorResponse ignores unknown RPC errors', () => {
      expect(
        quizRpcClientErrorResponse({ code: 'PGRST000', message: 'timeout' })
      ).toBeNull();
      expect(quizRpcClientErrorResponse(new Error('timeout'))).toBeNull();
    });
  });
});
