import type { PurchaseResult } from '@/lib/kuda';

/**
 * Whether a Monnify airtime vend should be retried through Kuda. Monnify
 * is the main airtime biller and Kuda the backup, so every vend Monnify
 * EXPLICITLY refused qualifies: a business rejection, a FAILED vend status,
 * or a 4xx refusal (low float, product or network trouble, ...). The vend
 * code marks those with providerDefiniteFailure; they are the same outcomes
 * that would otherwise fail and refund, so Kuda vends only where the
 * customer would have been refunded. Pending results, unknown outcomes
 * (timeouts and 5xx throw MonnifyTransientVendError and are requeried),
 * unrecognised statuses and duplicate-reference answers never qualify, so a
 * top-up Monnify may still deliver is never doubled through Kuda.
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
