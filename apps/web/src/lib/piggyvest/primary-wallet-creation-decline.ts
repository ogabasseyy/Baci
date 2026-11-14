import 'server-only';
import { PiggyvestApiError } from './client';

/** Classifies a definitive provider decline of the create call. */
export function classifyPrimaryWalletCreationDecline(
  error: unknown
): 'interest_routing' | 'bvn' | null {
  if (!(error instanceof PiggyvestApiError)) return null;
  if (
    error.declined &&
    (error.status === 400 || error.status === 422) &&
    /payout|interest/i.test(error.message)
  )
    return 'interest_routing';
  // Only 400 is a BVN verdict; every other status stays transport-ambiguous.
  return error.status === 400 ? 'bvn' : null;
}
