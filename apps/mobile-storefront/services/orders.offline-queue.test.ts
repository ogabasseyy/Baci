import { jest } from '@jest/globals';

type MockAuthUserResponse = {
  data: { user: { id: string } | null };
  error: null;
};

type MockAuthSessionResponse = {
  data: { session: { access_token: string } | null };
  error?: null;
};

type MockCreateOrderApiResponse = {
  order: {
    id: string;
    order_number: string;
    total: number;
    payment_status: string;
    shipping_status: string;
    tracking_token: string | null;
    created_at?: string;
  };
  wallet: null;
  amountDueToGateway: number;
};

const mockNetInfoFetch = jest.fn<() => Promise<{ isConnected: boolean }>>();
const mockSupabaseGetUser = jest.fn<() => Promise<MockAuthUserResponse>>();
const mockSupabaseGetSession =
  jest.fn<() => Promise<MockAuthSessionResponse>>();
const mockFetchJson = jest.fn<() => Promise<MockCreateOrderApiResponse>>();

type MockFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
};

type MockFetchOptions = {
  body: string;
  headers?: Record<string, string>;
};

const mockFetchResponse: MockFetchResponse = {
  ok: true,
  status: 200,
  json: mockFetchJson,
  headers: { get: () => null },
};
interface RetryOptions {
  maxRetries?: number;
  timeout?: number;
}

const mockFetchWithRetry = jest.fn<
  (
    url: string,
    options?: MockFetchOptions,
    retryOptions?: RetryOptions
  ) => Promise<MockFetchResponse>
>(async () => mockFetchResponse);

mockNetInfoFetch.mockResolvedValue({ isConnected: true });
mockSupabaseGetUser.mockResolvedValue({
  data: { user: { id: 'user-1' } },
  error: null,
});
mockSupabaseGetSession.mockResolvedValue({
  data: { session: { access_token: 'token-123' } },
  error: null,
});
mockFetchJson.mockResolvedValue({
  order: {
    id: 'order-1',
    order_number: 'ORD-001',
    total: 720000,
    payment_status: 'unpaid',
    shipping_status: 'pending',
    created_at: '2026-03-31T00:00:00Z',
    tracking_token: null,
  },
  wallet: null,
  amountDueToGateway: 720000,
});

jest.mock('@react-native-community/netinfo', () => ({
  fetch: mockNetInfoFetch,
}));

jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { merchantId: 'merchant-1', apiUrl: 'https://test.api' },
    },
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: () => ({ checkoutGeneration: 'cart-one' }) },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
  trackError: jest.fn(),
}));

jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { enqueue: jest.fn() },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mockSupabaseGetUser,
      getSession: mockSupabaseGetSession,
    },
  },
}));

jest.mock('@/lib/api', () => ({
  fetchWithRetry: mockFetchWithRetry,
  DEFAULT_TIMEOUT: 30000,
  ApiError: class extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  NetworkError: class extends Error {},
  RetryExhaustedError: class extends Error {},
  TimeoutError: class extends Error {},
}));

describe('createOrderWithOfflineSupport — offline queue contract', () => {
  const baseRequest = {
    customer_email: 'buyer@example.com',
    customer_name: 'Test Buyer',
    customer_phone: '+2348012345678',
    items: [{ id: 'item-1', name: 'Product', quantity: 1, price: 5000 }],
    subtotal: 5000,
    shipping_fee: 500,
    payment_method: 'pay_on_delivery' as const,
    source: 'mobile_app',
    shipping_address: {
      firstName: 'Test',
      lastName: 'Buyer',
      address: '123 St',
      city: 'Lagos',
      state: 'Lagos',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    mockSupabaseGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-123' } },
    });
    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const { offlineQueue } = require('@/lib/offline-queue');
    jest.mocked(offlineQueue.enqueue).mockResolvedValue('queue-id-1');
  });

  it('returns the order without queuing when the request succeeds', async () => {
    const { createOrderWithOfflineSupport } = require('./orders');
    mockFetchWithRetry.mockResolvedValueOnce(mockFetchResponse);

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(false);
    expect(result.order).toBeDefined();
    const { offlineQueue } = require('@/lib/offline-queue');
    expect(offlineQueue.enqueue).not.toHaveBeenCalled();
  });

  it('queues the order when createOrder encounters a NETWORK_ERROR', async () => {
    const { createOrderWithOfflineSupport } = require('./orders');
    const { NetworkError } = require('@/lib/api');
    mockFetchWithRetry.mockRejectedValueOnce(
      new NetworkError('connection refused')
    );

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(true);
    const { offlineQueue } = require('@/lib/offline-queue');
    expect(offlineQueue.enqueue).toHaveBeenCalledWith('create_order', {
      authPartition: 'guest',
      checkoutGeneration: 'cart-one',
      request: baseRequest,
    });
  });

  it('re-throws TIMEOUT_ERROR without queuing to avoid duplicate orders', async () => {
    const { createOrderWithOfflineSupport } = require('./orders');
    const { TimeoutError } = require('@/lib/api');
    mockFetchWithRetry.mockRejectedValueOnce(new TimeoutError('timed out'));

    await expect(
      createOrderWithOfflineSupport(baseRequest)
    ).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR',
    });

    const { offlineQueue } = require('@/lib/offline-queue');
    expect(offlineQueue.enqueue).not.toHaveBeenCalled();
  });
});
