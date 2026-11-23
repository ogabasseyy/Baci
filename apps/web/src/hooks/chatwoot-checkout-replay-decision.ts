import type { ChatwootCheckoutRememberedOrder } from './chatwoot-checkout-memory';
import { isChatwootCheckoutPaymentWindowOpen } from './chatwoot-checkout-payment-window';
import type {
  ChatwootCheckoutCreatedOrder,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';

export type ChatwootCheckoutReplayDecision =
  | { kind: 'refuse' }
  | {
      kind: 'answer';
      result: Extract<ChatwootCheckoutPlaceResult, { status: 'payment_ready' }>;
    }
  | { kind: 'start-payment'; order: ChatwootCheckoutCreatedOrder };

/**
 * What a repeat of an already-placed checkout request gets.
 * - Refused unless it comes from the merchant and conversation that placed it.
 * - Bank details still bound to the order are returned as they were, since
 *   asking again could mint a second account for the same order.
 * - Bank details past their window are never shown again: a transfer to them
 *   would no longer be matched to the order, so payment is set up afresh.
 */
export function decideChatwootCheckoutReplay(
  remembered: ChatwootCheckoutRememberedOrder,
  request: { requestId: string; conversationId: number; merchantId: string },
  now: number = Date.now()
): ChatwootCheckoutReplayDecision {
  if (
    remembered.merchantId !== request.merchantId ||
    remembered.conversationId !== request.conversationId
  ) {
    return { kind: 'refuse' };
  }
  const { order, payment } = remembered;
  if (
    payment &&
    isChatwootCheckoutPaymentWindowOpen(
      payment.issuedAt,
      now,
      payment.expiresAt
    )
  ) {
    return {
      kind: 'answer',
      result: {
        requestId: request.requestId,
        status: 'payment_ready',
        orderNumber: order.orderNumber,
        amountMajor: order.amountDueMajor,
        currency: 'NGN',
        bank: payment.bank,
        reference: payment.reference,
      },
    };
  }
  return { kind: 'start-payment', order };
}
