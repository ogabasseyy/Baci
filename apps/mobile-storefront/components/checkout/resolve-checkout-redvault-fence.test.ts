import { router } from 'expo-router';
import { Alert } from 'react-native';
import {
  readPersistedRedvaultOrder,
  resolvePersistedRedvaultOrder,
} from '@/lib/pending-redvault-order';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import {
  fetchFencedRedvaultOrderState,
  resolveCheckoutRedvaultFence,
  routeToPaidFenceOrder,
} from './resolve-checkout-redvault-fence';

jest.mock('@/lib/pending-redvault-order', () => ({
  readPersistedRedvaultOrder: jest.fn(),
  resolvePersistedRedvaultOrder: jest.fn(),
}));
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: jest.fn(),
}));
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));
jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_API_BASE_URL: 'https://api.example.test',
  CHECKOUT_MERCHANT_SLUG: 'ogabassey',
}));

const mockRead = readPersistedRedvaultOrder as jest.Mock;
const mockResolve = resolvePersistedRedvaultOrder as jest.Mock;
const mockCreateClient = createStorefrontCustomerApiClient as jest.Mock;
const mockAlert = Alert.alert as jest.Mock;
const mockReplace = router.replace as jest.Mock;

const RECORD = {
  orderId: 'order-rv',
  checkoutGeneration: 'gen-0',
  createdAt: '2026-09-20T00:00:00.000Z',
  trackingToken: 'track-rv',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateClient.mockReturnValue({ fetchJson: jest.fn() });
});

describe('resolveCheckoutRedvaultFence', () => {
  it('proceeds when no fence is persisted', async () => {
    mockRead.mockResolvedValue(null);

    await expect(resolveCheckoutRedvaultFence()).resolves.toEqual({
      proceed: true,
    });
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('blocks checkout while the fence is unresolved', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    global.fetch = jest.fn(async () =>
      Response.json({
        id: 'order-rv',
        payment_status: 'unpaid',
        shipping_status: 'pending',
      })
    ) as any;

    await expect(resolveCheckoutRedvaultFence()).resolves.toEqual({
      proceed: false,
    });
    expect(mockAlert).toHaveBeenCalledWith(
      'Payment still processing',
      expect.stringMatching(/still being verified/i)
    );
  });

  it('reports a paid fence with routing identity', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockImplementation(async ({ validateOrder }: any) => {
      await validateOrder('order-rv');
      return { blocked: false, paidOrderId: 'order-rv' };
    });
    global.fetch = jest.fn(async () =>
      Response.json({
        id: 'order-rv',
        order_number: 'RV-1',
        payment_status: 'paid',
        shipping_status: 'processing',
      })
    ) as any;

    await expect(resolveCheckoutRedvaultFence()).resolves.toEqual({
      proceed: true,
      paidOrderId: 'order-rv',
      paidOrderNumber: 'RV-1',
      paidTrackingToken: 'track-rv',
    });
  });

  it('blocks checkout when fence validation throws', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockRejectedValue(new Error('network down'));

    await expect(resolveCheckoutRedvaultFence()).resolves.toEqual({
      proceed: false,
    });
    expect(mockAlert).toHaveBeenCalledWith(
      'Unable to verify pending payment',
      expect.stringMatching(/could not check/i)
    );
  });
});

describe('fetchFencedRedvaultOrderState', () => {
  it('validates through the public token lookup without a session', async () => {
    global.fetch = jest.fn(async () =>
      Response.json({
        id: 'order-rv',
        order_number: 'RV-1',
        total: 1201500,
        payment_status: 'unpaid',
        shipping_status: 'pending',
      })
    ) as any;

    const state = await fetchFencedRedvaultOrderState(RECORD);

    expect(state).toEqual({
      id: 'order-rv',
      order_number: 'RV-1',
      total: 1201500,
      payment_status: 'unpaid',
      shipping_status: 'pending',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/storefront/orders/order-rv?tracking_token=track-rv&merchant_slug=ogabassey',
      expect.objectContaining({})
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('falls back to the account endpoint for legacy records', async () => {
    const fetchJson = jest.fn(async () => ({
      order: { id: 'order-rv', payment_status: 'paid' },
    }));
    mockCreateClient.mockReturnValue({ fetchJson });

    const state = await fetchFencedRedvaultOrderState({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-0',
      createdAt: '2026-09-20T00:00:00.000Z',
    });

    expect(state).toEqual({ id: 'order-rv', payment_status: 'paid' });
    expect(fetchJson).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/storefront/account/orders/order-rv',
    });
  });

  it('throws on a failed lookup', async () => {
    global.fetch = jest.fn(
      async () => new Response('nope', { status: 404 })
    ) as any;

    await expect(fetchFencedRedvaultOrderState(RECORD)).rejects.toThrow(
      /Unable to verify/
    );
  });
});

describe('routeToPaidFenceOrder', () => {
  it('clears the cart and routes to the completed order', async () => {
    const clearCart = jest.fn(async () => undefined);

    await routeToPaidFenceOrder({
      clearCart,
      orderId: 'order-rv',
      orderNumber: 'RV-1',
      trackingToken: 'track-rv',
    });

    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-rv',
        orderNumber: 'RV-1',
        paymentMethod: 'uba_redvault',
        trackingToken: 'track-rv',
      },
    });
  });
});
