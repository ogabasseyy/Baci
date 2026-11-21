import { buildCheckoutOrderRequest } from '@/components/storefront/ogabassey/pages/checkout/build-checkout-order-request';
import type { CartItem } from '@/hooks/cart';
import type { SharedCartCheckoutReview } from '@/hooks/cart/shared-cart-checkout-client';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { calculateOrderTotals } from '@/lib/checkout/calculate-order-totals';
import {
  calculateCartItemSubtotal,
  calculateCartTotal,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import type { ChatwootCheckoutDeliveryResult } from './chatwoot-checkout-delivery';

type ResolvedDelivery = Extract<ChatwootCheckoutDeliveryResult, { ok: true }>;

export interface ChatwootCheckoutOrderInput {
  review: SharedCartCheckoutReview;
  display: readonly CartItem[];
  delivery: ResolvedDelivery;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  /** Fractional VAT rate (0.075), or 0 when the merchant is not registered. */
  taxRate: number;
}

/** The order body, built by the same pure builders the store checkout uses. */
export function buildChatwootCheckoutOrderRequest(
  input: ChatwootCheckoutOrderInput,
  items: CartItem[]
) {
  const { review, delivery, customer } = input;
  const shipping = delivery.quote.price;
  return buildCheckoutOrderRequest({
    merchantId: review.merchantId,
    items: buildCheckoutOrderItems(items),
    paymentMethod: 'bank_transfer',
    acceptsMarketing: false,
    customer: {
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email,
      phone: customer.phone,
    },
    money: {
      subtotal: calculateCartTotal(items, true),
      shipping,
      // Parity snapshot only: the order API recomputes per-line VAT.
      tax: calculateOrderTotals({
        subtotal: calculateCartItemSubtotal(items, true),
        shippingFee: shipping,
        taxRate: input.taxRate,
      }).taxAmount,
      giftWrapping: 0,
      discountAmount: 0,
      discountCode: null,
      useWalletCredit: false,
      walletAmount: 0,
    },
    delivery: {
      method: delivery.method,
      airportType: 'delivery',
      quoteMatchesMethod: true,
      selectedQuoteId: String(delivery.quote.id),
      merchantRateId: delivery.merchantRateId,
      provider: null,
      address: delivery.address,
    },
    sharedCart: {
      cart_id: review.cartId,
      checkout_session_id: review.checkoutSessionId,
      checkout_generation: review.generation,
      cart_version: review.cartVersion,
    },
  });
}
