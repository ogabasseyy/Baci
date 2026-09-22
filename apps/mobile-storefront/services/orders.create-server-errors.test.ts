import { jest } from '@jest/globals';

import type {
  MockAuthSessionResponse,
  MockAuthUserResponse,
  MockCreateOrderApiResponse,
  MockFetchOptions,
  MockFetchResponse,
  RetryOptions,
} from './orders.create.test-utils';

const mockNetInfoFetch = jest.fn<() => Promise<{ isConnected: boolean }>>();
const mockSupabaseGetUser = jest.fn<() => Promise<MockAuthUserResponse>>();
const mockSupabaseGetSession =
  jest.fn<() => Promise<MockAuthSessionResponse>>();
const mockFetchJson = jest.fn<() => Promise<MockCreateOrderApiResponse>>();

const mockFetchResponse: MockFetchResponse = {
  ok: true,
  status: 200,
  json: mockFetchJson,
  headers: { get: () => null },
};

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

describe('createOrder — server errors', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    // Each test starts a fresh checkout attempt: without this, an earlier
    // test's frozen credit snapshot would strip later tests' credit fields.
    const { default: AsyncStorage } =
      require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    mockFetchResponse.ok = true;
    mockFetchResponse.status = 200;
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
  });

  it('surfaces known server validation details instead of the generic create-order error', async () => {
    const { createOrder } = require('./orders');

    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: jest.fn(() =>
        Promise.resolve({
          details: 'insufficient_stock',
          error: 'Failed to create order',
        })
      ),
    });

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        subtotal: 5000,
        shipping_fee: 500,
        payment_method: 'credit_direct',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: 'insufficient_stock',
      message:
        'This item is no longer available in the selected quantity. Please update your cart and try again.',
    });
  });

  it.each([
    {
      details: 'insufficient_variant_stock',
      message:
        'This item is no longer available in the selected option. Please update your cart and try again.',
    },
    {
      details: 'shipping_quote_required',
      message:
        'Delivery pricing changed. Please return to delivery and select a shipping option again.',
    },
    {
      details: 'order_total_mismatch',
      message:
        'Your cart total changed. Please review your order and try again.',
    },
  ])('maps server validation detail $details', async ({ details, message }) => {
    const { createOrder } = require('./orders');

    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: jest.fn(() =>
        Promise.resolve({
          details,
          error: 'Failed to create order',
        })
      ),
    });

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        subtotal: 5000,
        shipping_fee: 500,
        payment_method: 'credit_direct',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details,
      message,
    });
  });

  it.each([
    ['CHECKOUT_ORDER_NOT_REUSABLE', 'CHECKOUT_ORDER_NOT_REUSABLE'],
    ['order_not_reusable', 'CHECKOUT_ORDER_NOT_REUSABLE'],
    ['checkout_idempotency_conflict', 'CHECKOUT_IDEMPOTENCY_CONFLICT'],
  ])('normalizes checkout conflict code %s from the API', async (apiCode, expectedCode) => {
    const { createOrder } = require('./orders');

    mockFetchResponse.ok = false;
    mockFetchResponse.status = 409;
    mockFetchJson.mockResolvedValueOnce({
      code: apiCode,
      error:
        'This checkout order can no longer be reused. Refresh checkout and start a new order.',
    } as never);

    await expect(
      createOrder({
        customer_email: 'buyer@example.com',
        customer_name: 'Buyer User',
        customer_phone: '+2348012345678',
        idempotency_key: 'mobile-bnpl-key-1',
        items: [
          {
            id: 'prod-bnpl-1',
            name: 'BNPL Phone',
            quantity: 1,
            price: 120000,
          },
        ],
        payment_method: 'credit_direct',
        shipping_address: {
          address: '123 St',
          city: 'Lagos',
          firstName: 'Buyer',
          lastName: 'User',
          state: 'Lagos',
        },
        shipping_fee: 2000,
        subtotal: 120000,
      })
    ).rejects.toMatchObject({
      code: expectedCode,
      details: expect.objectContaining({
        code: expectedCode,
      }),
    });
  });
});
