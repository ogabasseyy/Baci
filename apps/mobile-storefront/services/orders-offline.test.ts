import { jest } from '@jest/globals';
import { OrderError } from './orders.errors';
import type { CreateOrderRequest } from './orders.schemas';

type CreateOrderResult = { order: { id: string } };

const mockCreateOrder = jest.fn<
  (
    request: CreateOrderRequest,
    options?: { checkoutGeneration?: string }
  ) => Promise<CreateOrderResult>
>(async () => ({ order: { id: 'order-1' } }));
const mockEnqueue = jest.fn<
  (type: string, payload: unknown) => Promise<string>
>(async () => 'queue-id-1');
const mockNetInfoFetch = jest.fn<
  () => Promise<{ isConnected: boolean; isInternetReachable: boolean }>
>(async () => ({
  isConnected: true,
  isInternetReachable: true,
}));

jest.mock('./orders', () => ({
  createOrder: mockCreateOrder,
}));

jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { enqueue: mockEnqueue },
}));

let mockCheckoutGeneration = 'cart-one';

jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => ({ checkoutGeneration: mockCheckoutGeneration }),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: () => mockNetInfoFetch(),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
}));

const baseRequest: CreateOrderRequest = {
  customer_email: 'buyer@example.com',
  customer_name: 'Test Buyer',
  customer_phone: '+2348012345678',
  items: [{ id: 'item-1', name: 'Product', quantity: 1, price: 5000 }],
  subtotal: 5000,
  shipping_fee: 500,
  payment_method: 'pay_on_delivery',
  shipping_address: {
    firstName: 'Test',
    lastName: 'Buyer',
    address: '123 St',
    city: 'Lagos',
    state: 'Lagos',
  },
  source: 'mobile_app',
};

describe('createOrderWithOfflineSupport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckoutGeneration = 'cart-one';
    mockNetInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it('returns the order without queuing when the request succeeds', async () => {
    const { createOrderWithOfflineSupport } =
      require('./orders-offline') as typeof import('./orders-offline');
    mockCreateOrder.mockResolvedValueOnce({ order: { id: 'order-1' } });

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('stores the originating generation when queueing after a network error', async () => {
    const { createOrderWithOfflineSupport } =
      require('./orders-offline') as typeof import('./orders-offline');
    mockCreateOrder.mockRejectedValueOnce(
      new OrderError('offline', 'NETWORK_ERROR')
    );

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(true);
    expect(mockCreateOrder).toHaveBeenCalledWith(baseRequest, {
      checkoutGeneration: 'cart-one',
    });
    expect(mockEnqueue).toHaveBeenCalledWith('create_order', {
      checkoutGeneration: 'cart-one',
      request: baseRequest,
    });
  });

  it('keeps the snapshot when the cart generation changes during the request', async () => {
    const { createOrderWithOfflineSupport } =
      require('./orders-offline') as typeof import('./orders-offline');
    mockCreateOrder.mockImplementation(async () => {
      mockCheckoutGeneration = 'cart-two';
      throw new OrderError('offline', 'NETWORK_ERROR');
    });

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledWith('create_order', {
      checkoutGeneration: 'cart-one',
      request: baseRequest,
    });
  });

  it('re-throws TIMEOUT_ERROR without queuing to avoid duplicate orders', async () => {
    const { createOrderWithOfflineSupport } =
      require('./orders-offline') as typeof import('./orders-offline');
    mockCreateOrder.mockRejectedValueOnce(
      new OrderError('timed out', 'TIMEOUT_ERROR')
    );

    await expect(
      createOrderWithOfflineSupport(baseRequest)
    ).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR',
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
