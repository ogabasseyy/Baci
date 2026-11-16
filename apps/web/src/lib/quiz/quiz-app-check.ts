import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

const APP_CHECK_JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';

export type QuizAppCheckConfig = {
  /** Firebase app ids (token `sub`) that count as the Ogabassey app. */
  allowedAppIds: readonly string[];
  /** Firebase project number; also the issuer and audience suffix. */
  projectNumber: string;
};

export type QuizAppCheckResult =
  | { ok: true; issuedAt: Date }
  | {
      ok: false;
      reason:
        | 'app_not_allowed'
        | 'invalid_token'
        | 'missing_token'
        | 'not_configured';
    };

type KeyResolver = (
  ...args: Parameters<JWTVerifyGetKey>
) => ReturnType<JWTVerifyGetKey>;

let remoteKeys: JWTVerifyGetKey | undefined;

function getRemoteKeys(): JWTVerifyGetKey {
  remoteKeys ??= createRemoteJWKSet(new URL(APP_CHECK_JWKS_URL));
  return remoteKeys;
}

/**
 * Verifies a Firebase App Check token (Play Integrity on Android, App Attest
 * on iOS, minted by the real app on a real device). Fails closed on any
 * problem; the caller decides whether a failure blocks or is only logged.
 */
export async function verifyQuizAppCheckToken(
  token: string | null,
  config: QuizAppCheckConfig,
  options: { keyResolver?: KeyResolver; now?: Date } = {}
): Promise<QuizAppCheckResult> {
  if (!config.projectNumber || config.allowedAppIds.length === 0) {
    return { ok: false, reason: 'not_configured' };
  }
  if (!token) return { ok: false, reason: 'missing_token' };

  let subject: string | undefined;
  let issuedAtSeconds: number | undefined;
  try {
    const { payload } = await jwtVerify(
      token,
      options.keyResolver ?? getRemoteKeys(),
      {
        algorithms: ['RS256'],
        clockTolerance: 30,
        audience: `projects/${config.projectNumber}`,
        currentDate: options.now,
        issuer: `https://firebaseappcheck.googleapis.com/${config.projectNumber}`,
      }
    );
    subject = payload.sub;
    issuedAtSeconds = payload.iat;
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }

  if (!subject || !config.allowedAppIds.includes(subject)) {
    return { ok: false, reason: 'app_not_allowed' };
  }
  if (typeof issuedAtSeconds !== 'number') {
    return { ok: false, reason: 'invalid_token' };
  }
  return { ok: true, issuedAt: new Date(issuedAtSeconds * 1000) };
}
