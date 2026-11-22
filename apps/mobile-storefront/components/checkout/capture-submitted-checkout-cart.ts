import { deferredBankOfferCart } from '@/lib/deferred-bank-offer-cart';
import { useCartStore } from '@/stores/cart-store';
import type { PaymentMethodType } from './PaymentMethodSelector';

export function captureSubmittedCheckoutCart(
  paymentMethod: PaymentMethodType | null
) {
  const { checkoutGeneration, cartWideNegotiationActive, items } =
    useCartStore.getState();
  return {
    itemsSnapshot: items.map((item) => ({
      ...item,
      ...(item.variant_attributes && {
        variant_attributes: { ...item.variant_attributes },
      }),
    })),
    checkoutGenerationSnapshot: checkoutGeneration,
    groupNegotiationSnapshot: cartWideNegotiationActive,
    checkoutCartIdentity:
      paymentMethod === 'paystack' ? deferredBankOfferCart.capture() : null,
  };
}
