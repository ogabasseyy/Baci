import { describe, expect, it, vi } from 'vitest';
import { initializeCheckoutGateway } from './initialize-checkout-gateway';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const options = {
  merchantId: 'merchant-1',
  order: { id: 'order-1' },
  currency: 'NGN',
  customerEmail: 'customer@example.com',
  customerName: 'Ada Customer',
  customerPhone: '08000000000',
  gateway: 'paystack' as const,
  billingAddress: { line1: '1 Main St', city: 'Lagos', country: 'NG' },
};

describe('initializeCheckoutGateway', () => {
  it('posts the stamped order and customer context to the selected rail', async () => {
    const request = vi.fn(async () =>
      response({ success: true, authorization_url: 'https://pay.example' })
    ) as unknown as typeof fetch;

    const result = await initializeCheckoutGateway({ ...options, request });

    expect(result).toEqual({
      success: true,
      authorization_url: 'https://pay.example',
    });
    expect(request).toHaveBeenCalledWith(
      '/api/payments/initialize',
      expect.objectContaining({
        body: expect.stringContaining('"order_id":"order-1"'),
      })
    );
  });

  it('keeps the initializer failure recoverable by surfacing its safe API message', async () => {
    await expect(
      initializeCheckoutGateway({
        ...options,
        request: vi.fn(async () =>
          response({ error: 'Gateway unavailable' }, 503)
        ) as unknown as typeof fetch,
      })
    ).rejects.toThrow('Gateway unavailable');
  });

  it('shows the payment fallback when an upstream failure returns HTML', async () => {
    const request = vi.fn(
      async () => new Response('<html>Bad Gateway</html>', { status: 502 })
    );

    await expect(
      initializeCheckoutGateway({ ...options, request })
    ).rejects.toThrow('Payment initialization failed');
  });
});
