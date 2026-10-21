import type { UtilityIdempotencyAttempt } from './use-utility-idempotency-key';
import { recallPendingVtuKey } from './utility-pending-idempotency';
import { schedulePendingVtuFlush } from './utility-pending-vtu-sync';
import { noteForgottenVtuScope } from './utility-pending-vtu-tombstones';

/**
 * Adopts the server's canonical (winner) key after an intent-claim
 * join, re-keying this submit's captured attempt so retries replay
 * the winner instead of the submitted loser. Split from
 * use-utility-purchase.ts per the 300-line module budget.
 * Awaited (Codex R1 P1) so the winner is durable before the
 * submit resolves; generation-bound (Codex R2 P1) on the
 * submitted loser key inside adoptCanonicalKey.
 *
 * Returns null unless the live entry actually holds the winner
 * afterwards (Codex R5 P1): a vetoed adoption (a newer generation
 * minted while this response was in flight) or a meanwhile-gone
 * entry must NOT retag — settling a stale winner key would let
 * scope-based terminal settlement delete the newer generation's
 * entry, and its lost-response retry would then mint fresh and
 * debit/vend twice. Null settles presentation-only (the result
 * still describes this submit's real vend); the newer generation
 * owns the registry. The re-read is synchronous in the same
 * microtask as the adoption's resolution, so nothing can
 * interleave between them; a rotation landing during the
 * adoption's own awaits fails safe toward null.
 * A non-durable adoption (false: memory rebound but the flush
 * failed) still retags (Codex P2): returning null would skip the
 * terminal reference/completion settlement, leaving an
 * uncompleted winner that the next tap replays misrecognized.
 * The persisted loser is tombstoned explicitly instead —
 * multi-key tombstones keep both records, so terminal settlement
 * cannot resurrect it.
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
  const durable = await adoptCanonicalKey(
    attempt.scoped,
    attempt.key,
    canonicalKey
  );
  if (!durable) {
    noteForgottenVtuScope(attempt.scoped, Date.now(), attempt.key);
    schedulePendingVtuFlush();
  }
  if (recallPendingVtuKey(attempt.scoped) !== canonicalKey) {
    return null;
  }
  return { ...attempt, key: canonicalKey };
}
