import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';

/**
 * Call-time twin of usePiggyvestPossible for submit-time checks: a render
 * value goes stale when a cached negative verdict expires mid-submit, so
 * this reads the verdict cache at the moment of the check. False only
 * while the server's ruling-out is still current.
 */
export function isPiggyvestPossibleNow(
  merchantId: string | null | undefined
): boolean {
  return readPiggyvestCapabilityNow(merchantId) !== false;
}
