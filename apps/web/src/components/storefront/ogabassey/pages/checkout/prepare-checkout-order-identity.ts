import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import {
  buildPendingCheckoutFingerprint,
  normalizeOrderPaymentMethod,
  type PendingCheckoutFingerprintInput,
} from './pending-checkout-order';
import type { PaymentMethod } from './types';

type CheckoutOrderIdentityInput = Omit<
  PendingCheckoutFingerprintInput,
  'items'
> & {
  items: CheckoutOrderItem[];
  paymentMethod: PaymentMethod;
};

/** Prepare the stable order identity shared by fresh submits and pending-order reuse. */
export function prepareCheckoutOrderIdentity({
  paymentMethod,
  items,
  ...fingerprintInput
}: CheckoutOrderIdentityInput) {
  const normalizedPaymentMethod = normalizeOrderPaymentMethod(paymentMethod);
  const checkoutFingerprint =
    (paymentMethod === 'uba_redvault' ? 'uba_redvault:' : '') +
    buildPendingCheckoutFingerprint({
      ...fingerprintInput,
      items: items.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        has_assurance: item.has_assurance,
        assurance_fee: item.assurance_fee,
        variantId: item.variantId,
        variantAttributes: item.variantAttributes,
      })),
    });

  return { items, normalizedPaymentMethod, checkoutFingerprint };
}
