import type { RefObject } from 'react';
import {
  type CheckoutSubmitFenceResult,
  type ResolveCheckoutSubmitFenceOptions,
  resolveCheckoutSubmitFence,
} from './checkout-submit-redvault';

export type AcquireCheckoutSubmitFenceOptions =
  ResolveCheckoutSubmitFenceOptions & {
    isOrderInFlight: RefObject<boolean>;
  };

/**
 * Acquires the synchronous in-flight latch and resolves the REDVAULT
 * submit fence. The latch is set BEFORE the network-backed fence await
 * so two rapid presses cannot both pass validation and continue into
 * duplicate order creation. Returns null (latch released) when the fence
 * declines the submit; on success the caller owns the held latch and
 * releases it through its own try/finally.
 */
export async function acquireCheckoutSubmitFence({
  isOrderInFlight,
  ...fenceOptions
}: AcquireCheckoutSubmitFenceOptions): Promise<CheckoutSubmitFenceResult | null> {
  isOrderInFlight.current = true;
  let submitFence: CheckoutSubmitFenceResult;
  try {
    submitFence = await resolveCheckoutSubmitFence(fenceOptions);
  } catch (error) {
    isOrderInFlight.current = false;
    throw error;
  }
  if (!submitFence.proceed) {
    isOrderInFlight.current = false;
    return null;
  }
  return submitFence;
}
