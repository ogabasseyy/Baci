import type { PurchaseResult } from '@/lib/kuda';

/**
 * Whether a Monnify airtime vend should be retried through Kuda. Monnify
 * is the main airtime biller and Kuda the backup, so a vend Monnify refused
 * BEFORE attempting it qualifies: the amount check, or Baci's Monnify float
 * being too low. The vend code marks those with providerDefiniteFailure;
 * they would otherwise fail and refund, so Kuda vends only where the
 * customer would have been refunded. Everything else never qualifies:
 * 401/403 login rejections (owner decision 2026-11-18), pending and unknown
 * outcomes, 408 timeouts, 429 throttles, FAILED or other vend statuses,
 * "unavailable" answers, code 99 and any duplicate-reference answer, since
 * Monnify may still have delivered.
 */
export function isMonnifyAirtimeKudaFallbackEligible(
  row: { amount: number; type: string },
  monnifyResult: PurchaseResult
): boolean {
  return (
    row.type === 'airtime' &&
    row.amount > 0 &&
    !monnifyResult.success &&
    monnifyResult.status === 'failed' &&
    monnifyResult.providerDefiniteFailure === true
  );
}
