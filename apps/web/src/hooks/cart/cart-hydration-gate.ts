import { readCustomerSessionHint } from '@/contexts/customer-session-hint';
import { hasActiveCartDeviceSession } from './cart-device-session-markers';
import { readCartSessionHint } from './cart-session-hint';
import { getSharedCartImportReceipt } from './cart-storage';

export interface CartHydrationGateInput {
  merchantId?: string | null;
  merchantSlug?: string | null;
  cachedCount: number;
}

/**
 * Returns true when an unauthenticated guest has no local cart state,
 * no legacy device session marker or import receipt, and either a `'0'`
 * or unset (`null`) cart hint — allowing passive visits and focus refreshes
 * to skip `GET /api/storefront/cart`.
 */
export function shouldSkipEmptyGuestCartFetch(
  input: CartHydrationGateInput
): boolean {
  if (input.cachedCount > 0 || readCustomerSessionHint() === '1') {
    return false;
  }
  if (
    hasActiveCartDeviceSession(input.merchantSlug) ||
    getSharedCartImportReceipt(input.merchantSlug) !== null
  ) {
    return false;
  }
  const cartHint = readCartSessionHint(input.merchantId);
  return cartHint === '0' || cartHint === null;
}
