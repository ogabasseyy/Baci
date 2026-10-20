import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';

/**
 * Adopts the server's canonical (winner) key after an intent-claim
 * join, re-keying this submit's captured attempt so retries replay
 * the winner instead of the submitted loser. Split from
 * use-utility-purchase.ts per the 300-line module budget.
 * Awaited (Codex R1 P1) so the winner is durable before the
 * submit resolves; generation-bound (Codex R2 P1) on the
 * submitted loser key inside adoptCanonicalKey.
 */
export async function adoptSubmittedCanonicalKey({
  adoptCanonicalKey,
  attempt,
  canonicalKey,
}: {
  adoptCanonicalKey: (
    scoped: string,
    expectedKey: string,
    key: string
  ) => Promise<boolean>;
  attempt: UtilityIdempotencyAttempt | null;
  canonicalKey: string | undefined;
}): Promise<UtilityIdempotencyAttempt | null> {
  if (!canonicalKey || !attempt) return attempt;
  await adoptCanonicalKey(attempt.scoped, attempt.key, canonicalKey);
  return { ...attempt, key: canonicalKey };
}
