/**
 * Whether a split the database answered adds up: a positive whole-number
 * principal no larger than the balance, and principal plus forfeited interest
 * equal to the balance. The runtime wrapper and the transfer layer share this
 * one predicate, so every dispatched-but-unsent outcome is released and paged
 * exactly once.
 */
export function isConsistentGoalCancelSplit(
  split: { principalKobo: number; forfeitedInterestKobo: number },
  balanceKobo: number
): boolean {
  return (
    Number.isSafeInteger(split.principalKobo) &&
    split.principalKobo >= 1 &&
    split.principalKobo <= balanceKobo &&
    split.principalKobo + split.forfeitedInterestKobo === balanceKobo
  );
}
