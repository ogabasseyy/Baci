import 'server-only';
import { PiggyvestApiError } from './client';

/**
 * True when the create-customer call provably created nothing: PiggyVest
 * rejected our API credentials (401/403) before processing the request, or
 * the egress relay refused before contacting PiggyVest. Unlike a timeout or
 * an unparseable reply, these are not ambiguous, so the onboarding attempt
 * can fail fast instead of parking the customer in an endless "pending".
 */
export function isPrimaryWalletCreateNotSent(
  error: unknown
): error is PiggyvestApiError {
  return (
    error instanceof PiggyvestApiError &&
    (error.code === 'PIGGYVEST_AUTH_ERROR' ||
      error.code === 'PIGGYVEST_RELAY_UNAVAILABLE')
  );
}
