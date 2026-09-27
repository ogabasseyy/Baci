import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import { getForwardableSelectedQuoteId } from './get-forwardable-selected-quote-id';
import type { DeliveryMethod } from './types';

export interface CheckoutOrderRequestInput {
  merchantId: string;
  items: CheckoutOrderItem[];
  paymentMethod: string;
  acceptsMarketing: boolean;
  customer: { name: string; email: string; phone: string; userId?: string };
  money: {
    subtotal: number;
    shipping: number;
    tax: number;
    giftWrapping: number;
    discountAmount: number;
    discountCode?: string | null;
    useWalletCredit: boolean;
    walletAmount: number;
  };
  delivery: {
    method: DeliveryMethod;
    airportType: 'delivery' | 'pickup';
    quoteMatchesMethod: boolean;
    selectedQuoteId: string;
    merchantRateId: string | null;
    provider: string | null;
    address: {
      address: string;
      city: string;
      state: string;
      phone: string;
      countryCode: string;
      country: string;
    };
  };
}

/** Client parity snapshot only: the order API recomputes authoritative money.
 * Keep fresh order and quote forwarding rules aligned with order reuse. */
export function buildCheckoutOrderRequest({
  merchantId,
  items,
  paymentMethod,
  acceptsMarketing,
  customer,
  money,
  delivery,
}: CheckoutOrderRequestInput) {
  const expectedTotal = Math.max(
    0,
    money.subtotal +
      money.shipping +
      money.giftWrapping +
      money.tax -
      money.discountAmount
  );
  return {
    merchant_id: merchantId,
    customer_email: customer.email,
    customer_name: customer.name,
    customer_phone: customer.phone,
    items,
    subtotal: money.subtotal,
    shipping_fee: money.shipping,
    tax_amount: money.tax,
    tax_basis: 'exclusive' as const,
    gift_wrapping_fee: money.giftWrapping,
    expected_total: expectedTotal,
    client_total: expectedTotal,
    ...(money.discountCode ? { discount_code: money.discountCode } : {}),
    payment_method: paymentMethod,
    payment_status: 'unpaid' as const,
    shipping_status: 'pending' as const,
    shipping_address: delivery.address,
    source: 'online_store' as const,
    delivery_method: delivery.method,
    ...(delivery.method === 'airport' && !delivery.quoteMatchesMethod
      ? { airport_type: delivery.airportType }
      : {}),
    shipping_provider: delivery.provider,
    ...(delivery.merchantRateId
      ? { shipping_rate_id: delivery.merchantRateId }
      : {}),
    selected_quote_id:
      delivery.method === 'airport'
        ? delivery.quoteMatchesMethod
          ? delivery.selectedQuoteId || null
          : null
        : (getForwardableSelectedQuoteId(
            delivery.method,
            delivery.selectedQuoteId
          ) ?? null),
    use_wallet_credit: money.useWalletCredit,
    wallet_amount: money.walletAmount,
    user_id: customer.userId,
    accepts_marketing: acceptsMarketing,
  };
}
