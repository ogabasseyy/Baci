import { createHash, randomBytes } from 'node:crypto';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateQuizAttestationNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidQuizAttestationNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_PATTERN.test(value);
}

export function hashQuizAttestationValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Returns the token only if it is a canonical compact JWT. The signature
 * segment is the one malleable part (padding or unused trailing bits decode to
 * the same bytes), so any non-canonical spelling is rejected and one verified
 * token can never yield two different replay hashes.
 */
export function canonicalQuizAppCheckToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (!parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const signature = parts[2];
  if (Buffer.from(signature, 'base64url').toString('base64url') !== signature) {
    return null;
  }
  return token;
}

export type QuizAttestationChallengeResult =
  | { expiresAt: string; nonce: string; status: 'ok' }
  | { status: 'error' | 'limit' };

/** Stores a new single-use challenge; reports a cap hit separately. */
export async function issueQuizAttestationChallenge(
  supabase: Pick<ServerSupabaseClient, 'rpc'>,
  eventId: string
): Promise<QuizAttestationChallengeResult> {
  const nonce = generateQuizAttestationNonce();
  const { data, error } = await supabase.rpc(
    'issue_quiz_app_attestation_challenge_v1',
    { p_event_id: eventId, p_nonce_hash: hashQuizAttestationValue(nonce) }
  );
  if (error) {
    // 54000 = the per-player open-challenge cap in the issuing function.
    const code = (error as { code?: unknown }).code;
    return { status: code === '54000' ? 'limit' : 'error' };
  }
  if (typeof data !== 'string') return { status: 'error' };
  return { expiresAt: data, nonce, status: 'ok' };
}

/** True only when this call consumed a valid, unexpired, unused challenge. */
export async function consumeQuizAttestationChallenge(
  supabase: Pick<ServerSupabaseClient, 'rpc'>,
  input: {
    eventId: string;
    nonce: string;
    token: string;
    tokenIssuedAt: Date;
  }
): Promise<boolean> {
  if (!isValidQuizAttestationNonce(input.nonce)) return false;
  const token = canonicalQuizAppCheckToken(input.token);
  if (!token) return false;
  const { data, error } = await supabase.rpc(
    'consume_quiz_app_attestation_challenge_v1',
    {
      p_event_id: input.eventId,
      p_nonce_hash: hashQuizAttestationValue(input.nonce),
      p_token_hash: hashQuizAttestationValue(token),
      p_token_issued_at: input.tokenIssuedAt.toISOString(),
    }
  );
  return !error && data === true;
}
