import { type NextRequest, NextResponse } from 'next/server';
import { getBearerTokenFromRequest, hasBearerAuthScheme } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { verifyQuizAccessToken } from '@/lib/quiz/quiz-access-token';
import { createAnonClient } from '@/lib/supabase/anon';
import { createScopedClient } from '@/lib/supabase/scoped';
import { createClient } from '@/lib/supabase/server';
import { mapQuizRpcClientError } from './quiz-rpc-client-errors';
import {
  hasRecentSessionCheck,
  recordSessionCheck,
} from './quiz-session-recency';
import type { ServerSupabaseClient } from './route-helpers-guards';

// Read-path auth and response helpers. Kept apart from route-helpers.ts so that
// read-only endpoints (e.g. the leaderboard GET) do not statically import the
// write-path proof/compliance machinery — which reaches the credential
// authority in env.ts. The event-pipeline boundary verifier fails any API route
// whose import graph reaches that credential authority, so this split is load-
// bearing, not cosmetic.

export type QuizAuthUser = { id: string };

export type RequireQuizUserOptions = {
  /**
   * Always ask Supabase Auth (session revocation matters) instead of trusting
   * a locally verified token. Use for routes that create or claim something.
   */
  requireFreshSession?: boolean;
  /**
   * Verify the token locally on every request and also ask Supabase Auth
   * about the session at most once a minute per token. For the answer route:
   * it changes state, so a signed-out or revoked session must stop within
   * about a minute, but a Supabase Auth call per answer (or an Auth outage)
   * must not cost a player a question.
   */
  requireRecentSession?: boolean;
};

type RequireQuizUserResult =
  | {
      response: null;
      supabase: ServerSupabaseClient;
      user: QuizAuthUser;
      authMethod: 'bearer' | 'cookie';
    }
  | {
      response: NextResponse;
      supabase: null;
      user: null;
    };

function getSafeAuthErrorFields(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { errorMessage: String(error) };
  }

  const fields: {
    errorCode?: string;
    errorMessage?: string;
    errorStatus?: number;
  } = {};
  if (
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    fields.errorMessage = (error as { message: string }).message;
  }
  if (
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    fields.errorCode = (error as { code: string }).code;
  }
  if (
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    fields.errorStatus = (error as { status: number }).status;
  }

  return fields;
}

function isMissingAuthSession(error: unknown) {
  const fields = getSafeAuthErrorFields(error);
  const errorMessage = fields.errorMessage?.toLowerCase() ?? '';
  const errorCode = fields.errorCode?.toLowerCase() ?? '';

  return (
    errorMessage.includes('auth session missing') ||
    errorMessage.includes('session missing') ||
    errorCode === 'session_not_found' ||
    errorCode === 'auth_session_missing' ||
    errorCode === 'no_authorization' ||
    (fields.errorStatus === 400 && errorMessage.includes('session'))
  );
}

function unauthorizedResult() {
  return {
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    supabase: null,
    user: null,
  } as const;
}

function authUnavailableResult() {
  return {
    // Supabase auth lookup errors are service failures, not bad credentials.
    response: NextResponse.json(
      { code: 'auth_unavailable', error: 'Authentication lookup failed' },
      { status: 503, headers: { 'Retry-After': '5' } }
    ),
    supabase: null,
    user: null,
  } as const;
}

// Supabase Auth answers a bad, expired or revoked token with a 4xx. Request
// timeout (408) and rate limiting (429) are about the service, not the token.
function isRejectedCredentialError(error: unknown) {
  const { errorStatus } = getSafeAuthErrorFields(error);
  return (
    errorStatus !== undefined &&
    errorStatus >= 400 &&
    errorStatus < 500 &&
    errorStatus !== 408 &&
    errorStatus !== 429
  );
}

async function checkBearerWithSupabaseAuth(
  token: string,
  { logOutage = true }: { logOutage?: boolean } = {}
): Promise<RequireQuizUserResult> {
  let user: QuizAuthUser | null = null;
  let error: unknown = null;
  try {
    const result = await createAnonClient().auth.getUser(token);
    user = result.data.user;
    error = result.error;
  } catch (thrown) {
    error = thrown ?? new Error('Auth lookup threw');
  }

  if (error) {
    if (isRejectedCredentialError(error)) return unauthorizedResult();
    if (logOutage) {
      logger.error({
        message: 'Quiz auth lookup failed',
        ...getSafeAuthErrorFields(error),
      });
    }
    return authUnavailableResult();
  }
  if (!user) return unauthorizedResult();

  recordSessionCheck(token);
  return {
    authMethod: 'bearer',
    response: null,
    // The scoped client is the real Supabase client; this local structural
    // type only narrows the quiz routes to the methods they use.
    supabase: createScopedClient(token) as unknown as ServerSupabaseClient,
    user: { id: user.id },
  };
}

export async function requireQuizUser(
  request?: NextRequest,
  options: RequireQuizUserOptions = {}
): Promise<RequireQuizUserResult> {
  const hasBearerScheme = request ? hasBearerAuthScheme(request) : false;
  const bearerToken = request ? getBearerTokenFromRequest(request) : null;
  if (request && hasBearerScheme) {
    if (!bearerToken) return unauthorizedResult();

    if (options.requireFreshSession) {
      return checkBearerWithSupabaseAuth(bearerToken);
    }

    const verified = await verifyQuizAccessToken(bearerToken);
    if (verified.status === 'verified') {
      if (options.requireRecentSession && !hasRecentSessionCheck(bearerToken)) {
        // Not logged per request: during an Auth outage this runs for every
        // answer, and the routes that must fail closed already log it.
        const session = await checkBearerWithSupabaseAuth(bearerToken, {
          logOutage: false,
        });
        if (session.response === null || session.response.status === 401) {
          return session;
        }
        // Supabase Auth could not answer. The signature is valid, so let the
        // answer through instead of costing the player a question; nothing is
        // remembered, so the next request asks again.
      }
      return {
        authMethod: 'bearer',
        response: null,
        supabase: createScopedClient(
          bearerToken
        ) as unknown as ServerSupabaseClient,
        user: { id: verified.userId },
      };
    }
    if (verified.status === 'invalid') return unauthorizedResult();
    return checkBearerWithSupabaseAuth(bearerToken);
  }

  const supabase = (await createClient()) as unknown as ServerSupabaseClient;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    if (isMissingAuthSession(error)) {
      return {
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        supabase: null,
        user: null,
      };
    }

    logger.error({
      message: 'Quiz auth lookup failed',
      ...getSafeAuthErrorFields(error),
    });
    return authUnavailableResult();
  }

  if (!user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      supabase: null,
      user: null,
    };
  }

  return {
    authMethod: 'cookie',
    response: null,
    supabase,
    user: { id: user.id },
  };
}

export function invalidInputResponse(details: unknown) {
  return NextResponse.json(
    { details, error: 'Invalid input' },
    { status: 400 }
  );
}

export function rpcErrorResponse() {
  return NextResponse.json({ error: 'Quiz request failed' }, { status: 500 });
}

export function quizRpcClientErrorResponse(error: unknown) {
  const mapped = mapQuizRpcClientError(error);
  if (!mapped) return null;

  return NextResponse.json(
    { code: mapped.code, error: mapped.error },
    {
      status: mapped.status,
      ...(mapped.retryAfterSeconds
        ? { headers: { 'Retry-After': String(mapped.retryAfterSeconds) } }
        : {}),
    }
  );
}
