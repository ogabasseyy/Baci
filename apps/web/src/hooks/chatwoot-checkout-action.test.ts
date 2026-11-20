import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleChatwootCheckoutAction } from './chatwoot-checkout-action';
import {
  placeInput,
  stubCheckoutFetch,
} from './chatwoot-checkout-test-fixtures';

const { postResult: _unused, request: _request, ...baseInput } = placeInput();

const statusMessage = {
  event: 'baci-checkout-payment-status-request' as const,
  data: {
    requestId: 'status-request-1',
    conversationId: 905,
    sessionToken: 'session-905',
    reference: 'ref_abc-123',
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('handleChatwootCheckoutAction payment status', () => {
  async function poll(
    handler: () => unknown,
    overrides: Partial<typeof baseInput> = {}
  ) {
    const { calls } = stubCheckoutFetch({ '/api/payments/status': handler });
    const post = vi.fn();
    await handleChatwootCheckoutAction({
      ...baseInput,
      ...overrides,
      message: statusMessage,
      post,
    });
    return { calls, post };
  }

  it('asks the Paystack status route for the reference and reports paid', async () => {
    const fetchSpy = vi.fn();
    const { calls, post } = await poll(() => {
      fetchSpy();
      return { body: { success: true, is_confirmed: true, is_pending: false } };
    });

    expect(calls).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('baci-checkout-payment-status:', {
      requestId: 'status-request-1',
      status: 'paid',
    });
  });

  it('requests the status route with the gateway and URL-encoded reference', async () => {
    const { fetchMock } = stubCheckoutFetch({
      '/api/payments/status': () => ({ body: { success: true } }),
    });
    await handleChatwootCheckoutAction({
      ...baseInput,
      message: {
        ...statusMessage,
        data: { ...statusMessage.data, reference: 'a=b.c' },
      },
      post: vi.fn(),
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/payments/status?gateway=paystack&reference=a%3Db.c'
    );
  });

  it('reports pending while the transfer is not confirmed', async () => {
    const { post } = await poll(() => ({
      body: { success: true, is_confirmed: false, is_pending: true },
    }));

    expect(post).toHaveBeenCalledWith('baci-checkout-payment-status:', {
      requestId: 'status-request-1',
      status: 'pending',
    });
  });

  it('reports unavailable for an error response, a failed lookup or an unusable body', async () => {
    for (const handler of [
      () => ({ status: 400, body: { error: 'Invalid' } }),
      () => ({ body: { success: false } }),
      () => ({ body: null }),
      () => {
        throw new Error('network down');
      },
    ]) {
      const { post } = await poll(handler);
      expect(post).toHaveBeenCalledWith('baci-checkout-payment-status:', {
        requestId: 'status-request-1',
        status: 'unavailable',
      });
    }
  });

  it('stays silent when the widget frame is no longer current', async () => {
    const { post } = await poll(() => ({ body: { success: true } }), {
      canPost: () => false,
    });

    expect(post).not.toHaveBeenCalled();
  });
});
