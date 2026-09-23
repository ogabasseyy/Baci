import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { cancelRedvaultOrder } from './cancel-redvault-order';

jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: jest.fn(),
}));
jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_API_BASE_URL: 'https://api.example.test',
}));

const mockCreateClient = createStorefrontCustomerApiClient as jest.Mock;

function mockFetchOnce(status: number, body: unknown = {}) {
  global.fetch = jest.fn(async () =>
    status >= 200 && status < 300
      ? Response.json(body)
      : new Response(JSON.stringify(body), { status })
  ) as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateClient.mockReturnValue({ fetchJson: jest.fn() });
});

describe('cancelRedvaultOrder', () => {
  it('cancels through the tracking-token guest route', async () => {
    mockFetchOnce(200, { success: true, cancelled: true });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'Customer resubmitted UBA checkout after app restart',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('cancelled');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/storefront/orders/order-rv/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tracking_token: 'track-rv',
          reason: 'Customer resubmitted UBA checkout after app restart',
        }),
      })
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('treats HTTP 200 as released', async () => {
    mockFetchOnce(200, { success: true, cancelled: false });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('cancelled');
  });

  it('retries the account route when the guest route 404s an attached order', async () => {
    mockFetchOnce(404, { error: 'Order not found' });
    const fetchJson = jest.fn(async () => ({ success: true, cancelled: true }));
    mockCreateClient.mockReturnValue({ fetchJson });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('cancelled');
    expect(fetchJson).toHaveBeenCalledWith({
      body: { reason: 'r' },
      method: 'POST',
      path: '/api/storefront/account/orders/order-rv/cancel',
    });
  });

  it('reports gone only after the account retry also finds nothing', async () => {
    mockFetchOnce(404, { error: 'Order not found' });
    mockCreateClient.mockReturnValue({
      fetchJson: jest.fn(async () => {
        throw new Error('Order not found');
      }),
    });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('gone');
  });

  it('fails closed on guest 404 when the account retry has no session', async () => {
    mockFetchOnce(404, { error: 'Order not found' });
    mockCreateClient.mockReturnValue({
      fetchJson: jest.fn(async () => {
        throw new Error('Authentication required. Please sign in again.');
      }),
    });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('failed');
  });

  it('reports live when the account retry finds an initializing order', async () => {
    mockFetchOnce(404, { error: 'Order not found' });
    const live = new Error('This order can no longer be cancelled') as Error & {
      code?: string;
    };
    live.code = 'order_not_cancellable';
    mockCreateClient.mockReturnValue({
      fetchJson: jest.fn(async () => {
        throw live;
      }),
    });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('live');
  });

  it('reports failure when the account retry errors', async () => {
    mockFetchOnce(404, { error: 'Order not found' });
    mockCreateClient.mockReturnValue({
      fetchJson: jest.fn(async () => {
        throw new Error('network down');
      }),
    });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('failed');
  });

  it('reports a live checkout on 409', async () => {
    mockFetchOnce(409, { code: 'order_not_cancellable' });

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('live');
  });

  it('reports failure on transport errors', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as any;

    await expect(
      cancelRedvaultOrder({
        orderId: 'order-rv',
        reason: 'r',
        trackingToken: 'track-rv',
      })
    ).resolves.toBe('failed');
  });

  it('falls back to the account route for legacy records', async () => {
    const fetchJson = jest.fn(async () => ({ success: true, cancelled: true }));
    mockCreateClient.mockReturnValue({ fetchJson });

    await expect(
      cancelRedvaultOrder({ orderId: 'order-rv', reason: 'r' })
    ).resolves.toBe('cancelled');
    expect(fetchJson).toHaveBeenCalledWith({
      body: { reason: 'r' },
      method: 'POST',
      path: '/api/storefront/account/orders/order-rv/cancel',
    });
  });

  it('releases the lane when the legacy account route finds nothing', async () => {
    mockCreateClient.mockReturnValue({
      fetchJson: jest.fn(async () => {
        throw new Error('Order not found');
      }),
    });

    await expect(
      cancelRedvaultOrder({ orderId: 'order-rv', reason: 'r' })
    ).resolves.toBe('gone');
  });

  it('maps the legacy non-cancellable code to live', async () => {
    const live = new Error('This order can no longer be cancelled') as Error & {
      code?: string;
    };
    live.code = 'order_not_cancellable';
    mockCreateClient.mockReturnValue({
      fetchJson: jest.fn(async () => {
        throw live;
      }),
    });

    await expect(
      cancelRedvaultOrder({ orderId: 'order-rv', reason: 'r' })
    ).resolves.toBe('live');
  });
});
