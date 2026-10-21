import {
  storefrontInternalPreflight,
  UNKNOWN_STOREFRONT_FAIL_OPEN_REASON,
} from './storefront-internal-preflight';
import type { StorefrontPreflightRpcContext } from './storefront-preflight-rpc';
import type { StorefrontPreflightRpcAttempt } from './storefront-preflight-rpc-attempt';

/**
 * Shared storefront-status gate for RPC verdict rows: true only for a
 * published storefront. Unknown/unpublished is the DESIGNED junk-traffic
 * fail-open (skip-logged, no capture — parity with the routes'
 * `failOpenReason: 'unknown-storefront'`); any future status value fails open
 * as a captured has-error, correlated with the producing attempt when known.
 */
export function gateStorefrontPreflightStatus(
  status: string,
  failOpenContext: StorefrontPreflightRpcContext,
  attempt?: StorefrontPreflightRpcAttempt | null
): boolean {
  if (status === 'published') {
    return true;
  }

  if (status === 'unknown' || status === 'unpublished') {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: UNKNOWN_STOREFRONT_FAIL_OPEN_REASON,
    });
  } else if (attempt) {
    storefrontInternalPreflight.warnRpcFailOpen(
      failOpenContext,
      { ...attempt, outcome: 'parse-error' },
      'has-error'
    );
  } else {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'has-error',
    });
  }
  return false;
}
