import 'server-only';

import { reserveAddressProviderRequest } from '@/lib/address-budget/reservation';

export type GoogleBudgetReservation =
  | { reserved: true; dispatchBefore: number }
  | { reserved: false; reason: 'limit_reached' | 'unavailable' };

/** All environments use the same verified, account-wide PostgreSQL ledger. */
export async function reserveGooglePlacesRequest(
  kind: 'autocomplete' | 'details',
  apiKey: string
): Promise<GoogleBudgetReservation> {
  try {
    const result = await reserveAddressProviderRequest('google', kind, apiKey);
    if (result.status === 'reserved')
      return { reserved: true, dispatchBefore: result.dispatchBefore };
    if (result.status === 'limit_reached')
      return { reserved: false, reason: 'limit_reached' };
  } catch {
    // An uncertain reservation stays consumed. Never retry or switch ledgers.
  }
  console.warn('[Address API] Google budget unavailable');
  return { reserved: false, reason: 'unavailable' };
}

export async function reserveGeoapifyRequest(
  apiKey: string
): Promise<GoogleBudgetReservation> {
  try {
    const reserve = () =>
      reserveAddressProviderRequest('geoapify', 'autocomplete', apiKey);
    let result = await reserve();
    // A pacing refusal creates no reservation. Wait once for the shared slot;
    // an unavailable allowance or exhausted cap never triggers another attempt.
    if (result.status === 'paced') {
      const delay = result.retryAfterMs;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      result = await reserve();
    }
    if (result.status === 'reserved')
      return { reserved: true, dispatchBefore: result.dispatchBefore };
    return {
      reserved: false,
      reason:
        result.status === 'limit_reached' ? 'limit_reached' : 'unavailable',
    };
  } catch {
    console.warn('[Address API] Geoapify budget unavailable');
    return { reserved: false, reason: 'unavailable' };
  }
}
