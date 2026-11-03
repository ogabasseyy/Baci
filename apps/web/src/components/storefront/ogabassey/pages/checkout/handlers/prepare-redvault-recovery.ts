import {
  getCartCookieEpoch,
  peekCartCookieEpoch,
} from '@/hooks/cart/cart-cross-tab-lock';
import { isCartSessionRetiring } from '@/hooks/cart/cart-session-write-fence';
import { getCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { buildCheckoutBillingAddress } from '../build-checkout-billing-address';
import type { buildCheckoutOrderRequest } from '../build-checkout-order-request';
import { saveRedvaultUncertainAttempt } from '../redvault-uncertain-attempt';

export type RedvaultAttemptFence = {
  merchantSlug: string | null;
  epoch: string | null;
  generation: number;
};

export function prepareRedvaultRecovery(input: {
  merchantSlug: string | null;
  merchantId: string;
  idempotencyKey: string;
  fingerprint: string;
  customer: { email: string; phone: string; name: string };
  shippingAddress: { address: string; city: string; state: string };
  merchantCountry: string;
  orderRequest: ReturnType<typeof buildCheckoutOrderRequest>;
}): RedvaultAttemptFence {
  const epoch = getCartCookieEpoch(input.merchantSlug);
  if (epoch === undefined || isCartSessionRetiring(input.merchantSlug)) {
    throw new Error('UBA checkout recovery is unavailable. Please try again.');
  }
  const fence = {
    merchantSlug: input.merchantSlug,
    epoch,
    generation: getCartSessionGeneration(input.merchantSlug),
  };
  saveRedvaultUncertainAttempt({
    merchantId: input.merchantId,
    idempotencyKey: input.idempotencyKey,
    fingerprint: input.fingerprint,
    customer: input.customer,
    billingAddress: buildCheckoutBillingAddress(
      input.shippingAddress.address,
      input.shippingAddress.city,
      input.shippingAddress.state,
      input.merchantCountry
    ),
    orderRequest: input.orderRequest,
  });
  return fence;
}

export function isRedvaultAttemptFenceCurrent(
  fence: RedvaultAttemptFence
): boolean {
  return (
    !isCartSessionRetiring(fence.merchantSlug) &&
    getCartSessionGeneration(fence.merchantSlug) === fence.generation &&
    peekCartCookieEpoch(fence.merchantSlug) === fence.epoch
  );
}
