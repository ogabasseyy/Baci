import type { EnsureCartResult } from './shared-cart-hook-support';

export interface EnsureCartFlight {
  generation: number;
  merchantId: string;
  merchantSlug: string | null;
  promise: Promise<EnsureCartResult>;
}

/**
 * Coalesces concurrent `ensureCart` calls for the same session generation and
 * merchant so parallel callers share one in-flight provisioning request.
 */
export async function runSingleFlightEnsureCart(
  flightRef: { current: EnsureCartFlight | null },
  key: Omit<EnsureCartFlight, 'promise'>,
  start: () => Promise<EnsureCartResult>
): Promise<EnsureCartResult> {
  const current = flightRef.current;
  if (
    current &&
    current.generation === key.generation &&
    current.merchantId === key.merchantId &&
    current.merchantSlug === key.merchantSlug
  ) {
    return current.promise;
  }

  const flight: EnsureCartFlight = {
    ...key,
    promise: start(),
  };
  flightRef.current = flight;
  try {
    return await flight.promise;
  } finally {
    if (flightRef.current === flight) {
      flightRef.current = null;
    }
  }
}
