import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleChatwootCheckoutAction } from './chatwoot-checkout-action';
import {
  rememberChatwootCheckoutOrder,
  rememberChatwootCheckoutPayment,
  resetChatwootCheckoutOrderMemory,
} from './chatwoot-checkout-memory';
import {
  placeInput,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

const { postResult: _unused, request: _request, ...baseInput } = placeInput();
const TRACK = '/api/storefront/orders/track-order';

const statusMessage = {
  event: 'baci-checkout-payment-status-request' as const,
  data: {
    requestId: 'status-request-1',
    conversationId: 905,
    sessionToken: 'session-905',
    reference: 'ref_abc-123',
  },
};

const issuedBank = {
  bankName: 'Test Bank',
  accountNumber: '0123456789',
  accountName: 'Test Store',
};

function issueReference(
  key: string,
  reference: string,
  overrides: {
    merchantId?: string;
    conversationId?: number;
    trackingToken?: string | null;
  } = {}
) {
  rememberChatwootCheckoutOrder(
    key,
    {
      merchantId: overrides.merchantId ?? 'merchant-1',
      conversationId: overrides.conversationId ?? 905,
    },
    {
      orderId: 'order-1',
      orderNumber: 'ORD-1001',
      trackingToken:
        overrides.trackingToken === undefined
          ? 'track-1'
          : overrides.trackingToken,
      amountDueMajor: 1000,
      currency: 'NGN',
    }
  );
  rememberChatwootCheckoutPayment(key, { bank: issuedBank, reference });
}

beforeEach(() => {
  resetChatwootCheckoutOrderMemory();
  issueReference('key-1', 'ref_abc-123');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('handleChatwootCheckoutAction payment status', () => {
  async function poll(
    handler: () => unknown,
    overrides: Partial<typeof baseInput> = {},
    reference = 'ref_abc-123'
  ) {
    const { calls, fetchMock } = stubCheckoutFetch({ [TRACK]: handler });
    const post = vi.fn();
    await handleChatwootCheckoutAction({
      ...baseInput,
      ...overrides,
      message: {
        ...statusMessage,
        data: { ...statusMessage.data, reference },
      },
      post,
    });
    return { calls, fetchMock, post };
  }
  const order = (fields: Record<string, unknown>) => () => ({
    body: { order: { id: 'order-1', ...fields } },
  });
  const posted = (status: string) => [
    'baci-checkout-payment-status:',
    { requestId: 'status-request-1', status },
  ];

  it('polls the order by its tracking token, never the payment-status route', async () => {
    const { fetchMock, post } = await poll(
      order({ payment_status: 'paid', shipping_status: 'pending' })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${TRACK}?token=track-1&merchant_slug=store`
    );
    expect(post).toHaveBeenCalledWith(...posted('paid'));
  });

  it('reports pending while the order is unpaid', async () => {
    const { post } = await poll(
      order({ payment_status: 'pending', shipping_status: 'pending' })
    );

    expect(post).toHaveBeenCalledWith(...posted('pending'));
  });

  it.each([
    ['failed', 'pending'],
    ['cancelled', 'pending'],
    ['refunded', 'pending'],
    ['pending', 'cancelled'],
  ])('reports a terminal order (payment %s, shipping %s) as unavailable', async (payment_status, shipping_status) => {
    const { post } = await poll(order({ payment_status, shipping_status }));

    expect(post).toHaveBeenCalledWith(...posted('unavailable'));
  });

  it('reports unavailable once the transfer window has passed unpaid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    resetChatwootCheckoutOrderMemory();
    issueReference('key-1', 'ref_abc-123');
    vi.setSystemTime(new Date('2026-11-20T11:31:00Z'));

    const { post } = await poll(order({ payment_status: 'pending' }));

    expect(post).toHaveBeenCalledWith(...posted('unavailable'));
  });

  it('still reports paid after the window when the transfer arrived', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    resetChatwootCheckoutOrderMemory();
    issueReference('key-1', 'ref_abc-123');
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));

    const { post } = await poll(order({ payment_status: 'paid' }));

    expect(post).toHaveBeenCalledWith(...posted('paid'));
  });

  it('ignores a verdict for a different order than the one the chat created', async () => {
    const { post } = await poll(() => ({
      body: { order: { id: 'someone-elses-order', payment_status: 'paid' } },
    }));

    expect(post).toHaveBeenCalledWith(...posted('unavailable'));
  });

  it('answers unavailable without any request when another conversation asks about the order', async () => {
    const { calls } = stubCheckoutFetch({});
    const post = vi.fn();
    await handleChatwootCheckoutAction({
      ...baseInput,
      message: {
        ...statusMessage,
        data: { ...statusMessage.data, conversationId: 906 },
      },
      post,
    });

    expect(calls).toHaveLength(0);
    expect(post).toHaveBeenCalledWith('baci-checkout-payment-status:', {
      requestId: 'status-request-1',
      status: 'unavailable',
    });
  });

  it('answers unavailable without any request for a reference this page did not issue', async () => {
    const { fetchMock, post } = await poll(
      order({ payment_status: 'paid' }),
      {},
      'someone-elses-reference'
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(...posted('unavailable'));
  });

  it('answers unavailable without a request when the order has no tracking token', async () => {
    resetChatwootCheckoutOrderMemory();
    issueReference('key-1', 'ref_abc-123', { trackingToken: null });

    const { fetchMock, post } = await poll(order({ payment_status: 'paid' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(...posted('unavailable'));
  });

  it('refuses to poll an order that belongs to a different merchant', async () => {
    resetChatwootCheckoutOrderMemory();
    issueReference('key-1', 'ref_abc-123', { merchantId: 'merchant-other' });

    const { fetchMock, post } = await poll(order({ payment_status: 'paid' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(...posted('unavailable'));
  });

  it('reports unavailable for an error response, an unusable body or a network failure', async () => {
    for (const handler of [
      () => ({ status: 404, body: { error: 'Not found' } }),
      () => ({ body: null }),
      () => ({ body: { order: null } }),
      () => {
        throw new Error('network down');
      },
    ]) {
      const { post } = await poll(handler);
      expect(post).toHaveBeenCalledWith(...posted('unavailable'));
    }
  });

  it('stays silent when the widget frame is no longer current', async () => {
    const { post } = await poll(order({ payment_status: 'paid' }), {
      canPost: () => false,
    });

    expect(post).not.toHaveBeenCalled();
  });
});
