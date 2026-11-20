import { requestDvaInitialization } from '@/components/storefront/ogabassey/pages/checkout/checkout-page-data-loaders';
import type { ChatwootCheckoutStatusResult } from './chatwoot-checkout-result';

export interface ChatwootCheckoutBank {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 120;

/**
 * Starts the Paystack dedicated-account (bank transfer) payment through the
 * store checkout's own request. The shopper-visible failure is bounded: the
 * server's message is never surfaced.
 */
export async function initializeChatwootCheckoutBankTransfer(input: {
  merchantId: string;
  orderId: string;
  trackingToken: string | null;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  address: { line1: string; city: string; state: string };
}): Promise<{ bank: ChatwootCheckoutBank; reference: string } | null> {
  try {
    const { dva, reference } = await requestDvaInitialization({
      merchantId: input.merchantId,
      orderId: input.orderId,
      customerEmail: input.customer.email,
      customerName:
        `${input.customer.firstName} ${input.customer.lastName}`.trim(),
      customerPhone: input.customer.phone,
      billingAddress: {
        line1: input.address.line1,
        city: input.address.city,
        state: input.address.state,
        country: 'NG',
      },
      orderCurrency: 'NGN',
      trackingToken: input.trackingToken,
    });
    if (
      !nonEmpty(dva?.bank_name) ||
      !nonEmpty(dva?.account_number) ||
      !nonEmpty(dva?.account_name) ||
      !nonEmpty(reference)
    ) {
      return null;
    }
    return {
      bank: {
        bankName: dva.bank_name,
        accountNumber: dva.account_number,
        accountName: dva.account_name,
      },
      reference,
    };
  } catch {
    return null;
  }
}

/**
 * A dedicated account is assigned for 60 minutes plus a 30 minute settlement
 * grace (persist-paystack-dva-assignment). After that an unpaid order will not
 * be confirmed by this transfer, so the poll reports it unavailable.
 */
const DVA_POLL_WINDOW_MS = 90 * 60 * 1000;
const TERMINAL_UNPAID_PAYMENT = new Set([
  'failed',
  'cancelled',
  'canceled',
  'refunded',
  'expired',
]);

/**
 * Polls the order, not a gateway reference: the reference issued with a
 * dedicated account is generated locally and Paystack never sees it, so only
 * the order's own payment status (set by the transfer webhook) is
 * authoritative. This is the poll the store checkout's transfer modal uses.
 */
export async function readChatwootCheckoutPaymentStatus(input: {
  requestId: string;
  orderId: string;
  trackingToken: string | null;
  merchantSlug: string;
  issuedAt: number;
}): Promise<ChatwootCheckoutStatusResult> {
  const { requestId } = input;
  const unavailable = { requestId, status: 'unavailable' as const };
  if (!input.trackingToken) return unavailable;
  try {
    const response = await fetch(
      `/api/storefront/orders/track-order?token=${encodeURIComponent(input.trackingToken)}&merchant_slug=${encodeURIComponent(input.merchantSlug)}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return unavailable;
    const body: unknown = await response.json().catch(() => null);
    const order = (
      body as {
        order?: {
          id?: unknown;
          payment_status?: unknown;
          shipping_status?: unknown;
        };
      } | null
    )?.order;
    // A token resolves whichever order it belongs to: bind the verdict to the
    // order this chat created.
    if (!order || order.id !== input.orderId) return unavailable;
    if (order.payment_status === 'paid') return { requestId, status: 'paid' };
    if (
      (typeof order.payment_status === 'string' &&
        TERMINAL_UNPAID_PAYMENT.has(order.payment_status)) ||
      order.shipping_status === 'cancelled' ||
      Date.now() - input.issuedAt > DVA_POLL_WINDOW_MS
    ) {
      return unavailable;
    }
    return { requestId, status: 'pending' };
  } catch {
    return unavailable;
  }
}
