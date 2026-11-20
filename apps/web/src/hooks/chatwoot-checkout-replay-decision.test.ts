import { describe, expect, it } from 'vitest';
import type { ChatwootCheckoutRememberedOrder } from './chatwoot-checkout-memory';
import { decideChatwootCheckoutReplay } from './chatwoot-checkout-replay-decision';

const NOW = 1_700_000_000_000;
const MINUTE = 60 * 1000;
const order = {
  orderId: 'order-1',
  orderNumber: 'ORD-1001',
  trackingToken: 'track-1',
  amountDueMajor: 4650,
  currency: 'NGN',
};
const bank = {
  bankName: 'Test Bank',
  accountNumber: '0123456789',
  accountName: 'Test Store',
};
const remembered = (
  issuedMinutesAgo: number | null
): ChatwootCheckoutRememberedOrder => ({
  merchantId: 'merchant-1',
  conversationId: 905,
  order,
  payment:
    issuedMinutesAgo === null
      ? null
      : { bank, reference: 'ref-1', issuedAt: NOW - issuedMinutesAgo * MINUTE },
});
const request = {
  requestId: 'request-1',
  conversationId: 905,
  merchantId: 'merchant-1',
};

describe('decideChatwootCheckoutReplay', () => {
  it('returns the issued bank details while they can still pay the order', () => {
    expect(decideChatwootCheckoutReplay(remembered(30), request, NOW)).toEqual({
      kind: 'answer',
      result: {
        requestId: 'request-1',
        status: 'payment_ready',
        orderNumber: 'ORD-1001',
        amountMajor: 4650,
        currency: 'NGN',
        bank,
        reference: 'ref-1',
      },
    });
  });

  it('never returns bank details past their 90 minute window', () => {
    expect(decideChatwootCheckoutReplay(remembered(91), request, NOW)).toEqual({
      kind: 'start-payment',
      order,
    });
  });

  it('sets up payment when none was issued yet', () => {
    expect(
      decideChatwootCheckoutReplay(remembered(null), request, NOW)
    ).toEqual({ kind: 'start-payment', order });
  });

  it('refuses another merchant or another conversation', () => {
    expect(
      decideChatwootCheckoutReplay(
        remembered(30),
        { ...request, merchantId: 'merchant-2' },
        NOW
      )
    ).toEqual({ kind: 'refuse' });
    expect(
      decideChatwootCheckoutReplay(
        remembered(30),
        { ...request, conversationId: 906 },
        NOW
      )
    ).toEqual({ kind: 'refuse' });
  });
});
