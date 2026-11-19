import 'server-only';

export type GoogleBudgetReservation =
  | { reserved: true }
  | { reserved: false; reason: 'limit_reached' | 'unavailable' };

/**
 * Address lookup relies on per-IP route rate limiting in proxy.ts rather than
 * a shared Redis counter, so Redis outages never block checkout delivery quotes.
 */
export function reserveGooglePlacesRequest(
  _kind: 'autocomplete' | 'details'
): Promise<GoogleBudgetReservation> {
  return Promise.resolve({ reserved: true });
}

export function reserveGeoapifyRequest(): Promise<boolean> {
  return Promise.resolve(true);
}
