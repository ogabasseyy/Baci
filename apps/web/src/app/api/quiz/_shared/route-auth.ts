import { type NextRequest, NextResponse } from 'next/server';
import { getBearerTokenFromRequest, hasBearerAuthScheme } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { verifyQuizAccessToken } from '@/lib/quiz/quiz-access-token';
import { createAnonClient } from '@/lib/supabase/anon';
import { createScopedClient } from '@/lib/supabase/scoped';
import { createClient } from '@/lib/supabase/server';
import {
  getSafeAuthErrorFields,
  isMissingAuthSession,
  isRejectedCredentialError,
} from './quiz-auth-lookup-errors';
import { mapQuizRpcClientError } from './quiz-rpc-client-errors';
import {
  noteSessionCheckSkipped,
  rememberSessionCheck,
  wasSessionCheckedRecently,
} from './quiz-session-recency';
import type { ServerSupabaseClient } from './route-helpers-guards';
import { DEADLINE_PASSED, withinDeadline } from './within-deadline';

// Read-path auth and response helpers. Kept apart from route-helpers.ts so that
// read-only endpoints (e.g. the leaderboard GET) do not statically import the
// write-path proof/compliance machinery — which reaches the credential
// authority in env.ts. The event-pipeline boundary verifier fails any API route
// whose import graph reaches that credential authority, so this split is load-
// bearing, not cosmetic.

export type QuizAuthUser = { id: string };

// How much each kind of quiz route trusts a token on its signature alone:
// - neither option (boards, counts, events, own result): signature only. A
//   signed-out or revoked token keeps READ access until it expires (access
//   tokens live one hour by default). Accepted so that polling by every
//   player during a live quiz never depends on Supabase Auth.
// - requireRecentSession (answers, resume): signature on every request,
//   Supabase Auth at most once a minute per token.
// - requireFreshSession (start, attestation, claims, awards): Supabase Auth on
//   every request; these fail closed when Supabase Auth cannot answer.
// These options shape the app's bearer path only. A browser (cookie) session
// is asked of Supabase Auth on every request whatever the option, because
// that call also refreshes the cookie, and it fails closed with a 503. Live
// quizzes can only be started from the app, so browser requests are few.
export type RequireQuizUserOptions = {
  /**
   * Always ask Supabase Auth (session revocation matters) instead of trusting
   * a locally verified token. Use for routes that create or claim something.
   */
  requireFreshSession?: boolean;
  /**
   * Verify the token locally on every request and also ask Supabase Auth
   * about the session at most once a minute per token. For the answer and
   * resume routes: they act on the live attempt, so a signed-out or revoked
   * session must stop within about a minute, but a Supabase Auth call per
   * answer must not cost a player a question.
   *
   * Deliberately fails OPEN when Supabase Auth cannot answer, or does not
   * within a second: the answer is accepted on the signature alone. What that exposes is narrow. The token
   * is still signed, unexpired and bound to one player; an attempt can only
   * be started with a live session (the start route fails closed); so the
   * most a revoked token can do is keep answering its own already-started
   * attempt for the length of the outage, capped by the token's expiry.
   * Failing closed instead would stop the quiz for every player whenever
   * Supabase Auth is slow.
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

// Longest the answer path waits for Supabase Auth before it lets a signed
// token through. Auth normally answers in well under 100 ms; the wait comes
// out of the player's time on the question.
const RECENT_SESSION_AUTH_DEADLINE_MS = 1_000;

async function checkBearerWithSupabaseAuth(
  token: string,
  options: { deadlineMs?: number; logOutage?: boolean } = {}
): Promise<RequireQuizUserResult> {
  const { deadlineMs, logOutage = true } = options;
  let user: QuizAuthUser | null = null;
  let error: unknown = null;
  try {
    const lookup = createAnonClient().auth.getUser(token);
    const result =
      deadlineMs === undefined
        ? await lookup
        : await withinDeadline(lookup, deadlineMs);
    if (result === DEADLINE_PASSED) {
      // Too slow for this request. If the lookup still confirms the session
      // when it arrives, remember it so the next answers do not wait again.
      void lookup
        .then((late) =>
          late.data.user && !late.error ? rememberSessionCheck(token) : null
        )
        .catch(() => null);
      error = new Error('Auth lookup timed out');
    } else {
      user = result.data.user;
      error = result.error;
    }
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

  await rememberSessionCheck(token);
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
      if (
        options.requireRecentSession &&
        !(await wasSessionCheckedRecently(bearerToken))
      ) {
        // Not logged per request: during an Auth outage this runs for every
        // answer, and the routes that must fail closed already log it.
        const session = await checkBearerWithSupabaseAuth(bearerToken, {
          deadlineMs: RECENT_SESSION_AUTH_DEADLINE_MS,
          logOutage: false,
        });
        if (session.response === null || session.response.status === 401) {
          return session;
        }
        // Supabase Auth could not answer, or not within a second. The
        // signature is valid, so let the answer through instead of costing
        // the player a question (see requireRecentSession for what this
        // exposes); nothing is remembered, so the next request asks again.
        noteSessionCheckSkipped();
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
    if (isMissingAuthSession(error)) return unauthorizedResult();

    logger.error({
      message: 'Quiz auth lookup failed',
      ...getSafeAuthErrorFields(error),
    });
    return authUnavailableResult();
  }

  if (!user) return unauthorizedResult();

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
