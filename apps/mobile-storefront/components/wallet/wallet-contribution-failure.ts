import { isPinCancelled } from '@/lib/wallet-pin-proof';
import { getErrorCode } from './savings/stored-contribution-operation';

/**
 * Settles a failed wallet contribution and says whether to tell the customer.
 * A closed PIN sheet sent nothing: the stored id and rail stay for the next
 * attempt and nothing is reported. WALLET_UNAVAILABLE means the server
 * cancelled the reservation, so its id can never be reused and is released.
 * Every other failure keeps the id (it may be indeterminate) and is reported.
 */
export function shouldReportContributionFailure(
  error: unknown,
  releaseOperation?: () => void
): boolean {
  if (isPinCancelled(error)) return false;
  if (getErrorCode(error) === 'WALLET_UNAVAILABLE') releaseOperation?.();
  return true;
}
