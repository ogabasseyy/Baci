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

/** Stores a new single-use challenge; returns its expiry or null on failure. */
export async function issueQuizAttestationChallenge(
  supabase: ServerSupabaseClient,
  eventId: string
): Promise<{ expiresAt: string; nonce: string } | null> {
  const nonce = generateQuizAttestationNonce();
  const { data, error } = await supabase.rpc(
    'issue_quiz_app_attestation_challenge_v1',
    { p_event_id: eventId, p_nonce_hash: hashQuizAttestationValue(nonce) }
  );
  if (error || typeof data !== 'string') return null;
  return { expiresAt: data, nonce };
}

/** True only when this call consumed a valid, unexpired, unused challenge. */
export async function consumeQuizAttestationChallenge(
  supabase: ServerSupabaseClient,
  input: {
    eventId: string;
    nonce: string;
    token: string;
    tokenIssuedAt: Date;
  }
): Promise<boolean> {
  if (!isValidQuizAttestationNonce(input.nonce)) return false;
  const { data, error } = await supabase.rpc(
    'consume_quiz_app_attestation_challenge_v1',
    {
      p_event_id: input.eventId,
      p_nonce_hash: hashQuizAttestationValue(input.nonce),
      p_token_hash: hashQuizAttestationValue(input.token),
      p_token_issued_at: input.tokenIssuedAt.toISOString(),
    }
  );
  return !error && data === true;
}
