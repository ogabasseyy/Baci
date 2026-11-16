import { createLogger } from '@/lib/logger';
import { quizAttestationChallengeResponseSchema } from '@/schemas/quiz-attestation-schemas';
import { requestQuizV2 } from '@/services/quiz-request';

const log = createLogger('QuizAttestation');

export const QUIZ_APP_CHECK_HEADER = 'X-Firebase-AppCheck';
export const QUIZ_ATTESTATION_NONCE_HEADER = 'X-Baci-Quiz-Attestation-Nonce';

/** Mints a one-time Firebase App Check token (Play Integrity / App Attest). */
export type LimitedUseTokenProvider = () => Promise<string | null>;

let registeredProvider: LimitedUseTokenProvider | null = null;

/**
 * Registers the native App Check token source (Firebase `getLimitedUseToken`).
 * Not wired yet: `@react-native-firebase/app-check` is blocked by pnpm's trust
 * check and needs an owner decision plus a native build. Until it is
 * registered no attestation is sent, and the server (monitor/enforce) decides.
 */
export function registerQuizAttestationTokenProvider(
  provider: LimitedUseTokenProvider | null
): void {
  registeredProvider = provider;
}

async function defaultLimitedUseToken(): Promise<string | null> {
  return registeredProvider ? await registeredProvider() : null;
}

/**
 * Gets a server challenge, then a fresh limited-use App Check token minted
 * AFTER it. Returns the two request headers, or null when the device cannot
 * attest. Never throws: a failed attestation must not crash quiz start; the
 * server refuses the live start itself when it requires attestation.
 */
export async function getQuizAttestationHeaders(
  eventId: string,
  options: { baseUrl?: string; expectedUserId?: string },
  tokenProvider: LimitedUseTokenProvider = defaultLimitedUseToken
): Promise<Record<string, string> | null> {
  // Nothing can attest until a provider is registered: skip the challenge
  // request so an unattestable start is never delayed by it.
  if (tokenProvider === defaultLimitedUseToken && !registeredProvider) {
    return null;
  }
  try {
    const challenge = await requestQuizV2(
      '/api/quiz/attestation/challenge',
      { body: JSON.stringify({ eventId }), method: 'POST' },
      quizAttestationChallengeResponseSchema,
      options
    );
    const token = await tokenProvider();
    if (!token) return null;
    return {
      [QUIZ_APP_CHECK_HEADER]: token,
      [QUIZ_ATTESTATION_NONCE_HEADER]: challenge.nonce,
    };
  } catch (error) {
    // Keep the real cause visible in dev logs; the server decides the outcome.
    log.warn('Could not obtain a quiz attestation', error);
    return null;
  }
}
