import { readCustomerSessionHint } from '@/contexts/customer-session-hint';
import {
  clearCartDeviceSessionActive,
  hasActiveCartDeviceSession,
  markCartDeviceSessionActive,
} from './cart-device-session-markers';
import { readCartSessionHint, writeCartSessionHint } from './cart-session-hint';
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

/**
 * Stamps `'0'` when an initial cold visit skips fetching so subsequent
 * visits remain silent until a mutation or sign-in occurs.
 */
export function stampSkippedEmptyGuestCartHint(
  merchantId?: string | null
): void {
  if (readCartSessionHint(merchantId) === null) {
    writeCartSessionHint(merchantId, '0');
  }
}

/**
 * Synchronizes the merchant-scoped cart hint cookie and device-session
 * active marker after a snapshot adoption or non-retryable fetch outcome.
 */
export function syncCartSessionMarkers(params: {
  merchantId?: string | null;
  merchantSlug?: string | null;
  active: boolean;
  preserveDeviceMarker?: boolean;
}): void {
  writeCartSessionHint(params.merchantId, params.active ? '1' : '0');
  if (!params.merchantSlug) return;
  if (params.active) {
    markCartDeviceSessionActive(params.merchantSlug);
  } else if (!params.preserveDeviceMarker) {
    clearCartDeviceSessionActive(params.merchantSlug);
  }
}
