import { hasNeverReachedCause } from './never-reached-cause';

/** Errors the provider-call boundary proved never opened a connection. */
const providerNeverReachedErrors = new WeakSet<object>();

/**
 * Tag an error thrown by the provider booking call itself. Only tagged errors
 * count as "never reached": a database or other connection failure that
 * happens after the carrier booked the parcel must keep the lock.
 */
export function tagProviderCallError(error: unknown): void {
  if (
    typeof error === 'object' &&
    error !== null &&
    hasNeverReachedCause(error)
  ) {
    providerNeverReachedErrors.add(error);
  }
}

/** True when the provider-call boundary proved the connection never opened. */
export function isProviderNeverReachedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    providerNeverReachedErrors.has(error)
  );
}
