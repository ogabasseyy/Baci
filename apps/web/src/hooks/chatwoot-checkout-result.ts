/**
 * Bounded result vocabulary for the in-chat checkout bridge. The widget only
 * ever receives these fixed codes, the order number and the payment
 * reference: never server error text, tokens or internal ids.
 */
export const CHATWOOT_CHECKOUT_PLACE_PREFIX = 'baci-checkout-place-result:';
export const CHATWOOT_CHECKOUT_STATUS_PREFIX = 'baci-checkout-payment-status:';

export const CHATWOOT_CHECKOUT_FAILURE_CODES = [
  'disabled',
  'cart_changed',
  'delivery_unavailable',
  'details_invalid',
  'order_failed',
  'payment_unavailable',
  'cart_unsupported',
] as const;

export type ChatwootCheckoutFailureCode =
  (typeof CHATWOOT_CHECKOUT_FAILURE_CODES)[number];

export interface ChatwootCheckoutCreatedOrder {
  orderId: string;
  orderNumber: string;
  trackingToken: string | null;
  amountDueMajor: number;
  currency: string | null;
}

export type ChatwootCheckoutPlaceResult =
  | {
      requestId: string;
      status: 'payment_ready';
      orderNumber: string;
      amountMajor: number;
      currency: 'NGN';
      bank: { bankName: string; accountNumber: string; accountName: string };
      reference: string;
    }
  | {
      /** A repeat found the order already paid; no bank details are issued. */
      requestId: string;
      status: 'paid';
      orderNumber: string;
    }
  | {
      requestId: string;
      status: 'failed';
      code: ChatwootCheckoutFailureCode;
      /** Present only when the order exists but payment could not start. */
      orderNumber?: string;
    };

export type ChatwootCheckoutStatusResult = {
  requestId: string;
  status: 'paid' | 'pending' | 'unavailable';
};

export function isChatwootCheckoutEvent(
  event: string
): event is
  | 'baci-checkout-place-request'
  | 'baci-checkout-payment-status-request' {
  return (
    event === 'baci-checkout-place-request' ||
    event === 'baci-checkout-payment-status-request'
  );
}
