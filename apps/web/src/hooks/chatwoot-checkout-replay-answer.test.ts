import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerChatwootCheckoutReplay } from './chatwoot-checkout-replay-answer';
import { stubCheckoutFetch } from './chatwoot-checkout-test-fixtures';

afterEach(() => vi.unstubAllGlobals());

const order = {
  orderId: 'order-uuid',
  orderNumber: 'ORD-1001',
  trackingToken: 'track-1' as string | null,
  amountDueMajor: 4650,
  currency: 'NGN',
};
const cached = {
  requestId: 'request-1',
  status: 'payment_ready' as const,
  orderNumber: 'ORD-1001',
  amountMajor: 4650,
  currency: 'NGN' as const,
  bank: {
    bankName: 'Test Bank',
    accountNumber: '0123456789',
    accountName: 'Test Store',
  },
  reference: 'ref-1',
};
const answer = (overrides: { order?: typeof order } = {}) =>
  answerChatwootCheckoutReplay({
    cached,
    order: overrides.order ?? order,
    storeSlug: 'store',
    issuedAt: Date.now(),
  });
const track = (body: Record<string, unknown>, status = 200) =>
  stubCheckoutFetch({
    '/api/storefront/orders/track-order': () => ({ status, body }),
  });

describe('answerChatwootCheckoutReplay', () => {
  it('returns the cached bank details while the order is still unpaid', async () => {
    track({ order: { id: 'order-uuid', payment_status: 'pending' } });

    expect(await answer()).toBe(cached);
  });

  it('reports the order paid instead of showing the account again', async () => {
    track({ order: { id: 'order-uuid', payment_status: 'paid' } });

    expect(await answer()).toEqual({
      requestId: 'request-1',
      status: 'paid',
      orderNumber: 'ORD-1001',
    });
  });

  it.each([
    ['cancelled', { order: { id: 'order-uuid', payment_status: 'cancelled' } }],
    [
      'cancelled in shipping',
      {
        order: {
          id: 'order-uuid',
          payment_status: 'pending',
          shipping_status: 'canceled',
        },
      },
    ],
    [
      'a different order',
      { order: { id: 'other', payment_status: 'pending' } },
    ],
  ])('offers no payment when the order is %s', async (_label, body) => {
    track(body);

    expect(await answer()).toEqual({
      requestId: 'request-1',
      status: 'failed',
      code: 'payment_unavailable',
      orderNumber: 'ORD-1001',
    });
  });

  it('offers no payment when the order cannot be read', async () => {
    track({}, 500);
    expect(await answer()).toMatchObject({
      status: 'failed',
      code: 'payment_unavailable',
    });

    const { calls } = track({});
    expect(
      await answer({ order: { ...order, trackingToken: null } })
    ).toMatchObject({ status: 'failed', code: 'payment_unavailable' });
    expect(calls).toHaveLength(0);
  });
});
