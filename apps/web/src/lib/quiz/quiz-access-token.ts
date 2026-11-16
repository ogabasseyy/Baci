import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  type JWTVerifyGetKey,
  jwtVerify,
} from 'jose';
import { logger } from '@/lib/logger';
import { getSupabaseAuthRuntimeConfig } from '@/lib/supabase/supabase-auth-runtime-config';

// Local verification of Supabase access tokens for the quiz routes. The quiz
// read path runs thousands of requests per second during a live quiz, so a
// network round trip to Supabase Auth per request does not scale. PostgREST
// verifies the very same token on every database call made with the scoped
// client, so verifying here does not weaken database access control.
//
// Deliberately does not import the broad env module: read-path quiz routes
// must not reach the credential authority (see route-auth.ts).

const ALLOWED_ALGORITHMS = ['ES256', 'RS256'] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Errors that prove the token itself is bad. Anything else (key lookup or
// JWKS fetch trouble) says nothing about the token and is "unverifiable".
const INVALID_TOKEN_ERROR_CODES = new Set([
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_INVALID',
  'ERR_JOSE_ALG_NOT_ALLOWED',
]);

export type QuizAccessTokenResult =
  | { status: 'verified'; userId: string }
  | { status: 'invalid' }
  | { status: 'unverifiable' };

export type QuizAccessTokenOptions = {
  currentDate?: Date;
  /** Test seam: replaces the remote JWKS. */
  keyResolver?: JWTVerifyGetKey;
  /** Test seam: replaces NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string;
};

let cachedRemoteKeys: { keys: JWTVerifyGetKey; url: string } | undefined;

function getRemoteKeys(supabaseUrl: string): JWTVerifyGetKey {
  if (cachedRemoteKeys?.url !== supabaseUrl) {
    cachedRemoteKeys = {
      keys: createRemoteJWKSet(
        new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      ),
      url: supabaseUrl,
    };
  }
  return cachedRemoteKeys.keys;
}

function resolveSupabaseUrl(override?: string): string | null {
  try {
    const url = override ?? getSupabaseAuthRuntimeConfig().url;
    return url.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** true = allowed alg, false = another alg, null = not a decodable JWT. */
function hasAllowedAlgorithm(token: string): boolean | null {
  try {
    const { alg } = decodeProtectedHeader(token);
    return (
      typeof alg === 'string' &&
      (ALLOWED_ALGORITHMS as readonly string[]).includes(alg)
    );
  } catch {
    return null;
  }
}

let warnedAboutUnexpectedClaim = false;

/**
 * An issuer or audience this deployment did not expect points at
 * configuration (for example a custom Supabase domain), not at a bad token.
 * Returns the claim name so the caller can let Supabase Auth decide instead
 * of signing every player out.
 */
function getUnexpectedConfigurationClaim(error: unknown): string | null {
  if (getErrorCode(error) !== 'ERR_JWT_CLAIM_VALIDATION_FAILED') return null;
  const { claim } = error as { claim?: unknown };
  return claim === 'iss' || claim === 'aud' ? claim : null;
}

function getErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Verifies a Supabase access token against the project's published JWKS.
 * Never throws. `invalid` means the token is provably bad; `unverifiable`
 * means this process could not decide (legacy HS256 token, unknown key id,
 * JWKS unreachable, unexpected issuer or audience) and the caller should ask
 * Supabase Auth instead.
 */
export async function verifyQuizAccessToken(
  token: string,
  options: QuizAccessTokenOptions = {}
): Promise<QuizAccessTokenResult> {
  const algorithmAllowed = hasAllowedAlgorithm(token);
  if (algorithmAllowed === null) return { status: 'invalid' };
  if (!algorithmAllowed) return { status: 'unverifiable' };

  const supabaseUrl = resolveSupabaseUrl(options.supabaseUrl);
  if (!supabaseUrl) return { status: 'unverifiable' };

  try {
    const { payload } = await jwtVerify(
      token,
      options.keyResolver ?? getRemoteKeys(supabaseUrl),
      {
        algorithms: [...ALLOWED_ALGORITHMS],
        audience: 'authenticated',
        currentDate: options.currentDate,
        issuer: `${supabaseUrl}/auth/v1`,
      }
    );

    const subject = payload.sub;
    if (
      typeof subject !== 'string' ||
      !UUID_PATTERN.test(subject) ||
      payload.role !== 'authenticated' ||
      payload.is_anonymous === true
    ) {
      return { status: 'invalid' };
    }
    return { status: 'verified', userId: subject };
  } catch (error) {
    const unexpectedClaim = getUnexpectedConfigurationClaim(error);
    if (unexpectedClaim) {
      if (!warnedAboutUnexpectedClaim) {
        warnedAboutUnexpectedClaim = true;
        logger.warn({
          claim: unexpectedClaim,
          message:
            'Quiz access token has an unexpected issuer or audience; falling back to Supabase Auth',
        });
      }
      return { status: 'unverifiable' };
    }
    const code = getErrorCode(error);
    if (code && INVALID_TOKEN_ERROR_CODES.has(code)) {
      return { status: 'invalid' };
    }
    return { status: 'unverifiable' };
  }
}
