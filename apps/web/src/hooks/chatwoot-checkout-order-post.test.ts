import { afterEach, describe, expect, it, vi } from 'vitest';
import { postChatwootCheckoutOrder } from './chatwoot-checkout-order-post';
import type { buildChatwootCheckoutOrderRequest } from './chatwoot-checkout-order-request';
import { stubCheckoutFetch } from './chatwoot-checkout-test-fixtures';

type Body = ReturnType<typeof buildChatwootCheckoutOrderRequest>;
const body = { merchant_id: 'merchant-1' } as unknown as Body;

afterEach(() => vi.unstubAllGlobals());

function post(response: unknown) {
  const stub = stubCheckoutFetch({ '/api/orders': () => response });
  return { ...stub, result: postChatwootCheckoutOrder(body, 'cw-chk-key') };
}

describe('postChatwootCheckoutOrder', () => {
  it('sends the key header and body and returns bounded order fields', async () => {
    const { calls, result } = post({
      status: 201,
      body: {
        order: {
          id: 'o1',
          order_number: 'ORD-1',
          total: 10,
          tracking_token: 'tok',
          currency: 'ngn',
          secret: 'x',
        },
        amountDueToGateway: 10,
      },
    });

    expect(await result).toEqual({
      ok: true,
      order: {
        orderId: 'o1',
        orderNumber: 'ORD-1',
        trackingToken: 'tok',
        amountDueMajor: 10,
        currency: 'NGN',
      },
    });
    expect(
      (calls[0]?.init.headers as Record<string, string>)['Idempotency-Key']
    ).toBe('cw-chk-key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(body);
  });

  it('falls back to the order total and treats a blank token as absent', async () => {
    const { result } = post({
      body: {
        order: {
          id: 'o1',
          order_number: 'ORD-1',
          total: 7,
          tracking_token: ' ',
        },
      },
    });

    expect(await result).toMatchObject({
      ok: true,
      order: { amountDueMajor: 7, trackingToken: null, currency: null },
    });
  });

  it('reports a fully covered (zero) order as failed rather than payable', async () => {
    const { result } = post({
      body: {
        order: { id: 'o1', order_number: 'ORD-1' },
        amountDueToGateway: 0,
      },
    });

    expect(await result).toEqual({ ok: false, code: 'order_failed' });
  });

  it.each([
    ['SHIPPING_RATE_INVALID', 'delivery_unavailable'],
    ['SHIPPING_FEE_MISMATCH', 'delivery_unavailable'],
    ['CHECKOUT_IDEMPOTENCY_CONFLICT', 'cart_changed'],
    ['CHECKOUT_ORDER_NOT_REUSABLE', 'cart_changed'],
    ['SOMETHING_ELSE', 'order_failed'],
  ])('maps server code %s to %s', async (code, expected) => {
    const { result } = post({ status: 400, body: { code, details: 'secret' } });

    expect(await result).toEqual({ ok: false, code: expected });
  });

  it('fails without a usable response', async () => {
    expect(await post({ status: 500, body: null }).result).toEqual({
      ok: false,
      code: 'order_failed',
    });
    expect(await post({ body: { order: {} } }).result).toEqual({
      ok: false,
      code: 'order_failed',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    expect(await postChatwootCheckoutOrder(body, 'k')).toEqual({
      ok: false,
      code: 'order_failed',
    });
  });
});
