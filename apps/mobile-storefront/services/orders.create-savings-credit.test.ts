import { jest } from '@jest/globals';
import type {
  MockAuthSessionResponse,
  MockAuthUserResponse,
  MockCreateOrderApiResponse,
  MockFetchOptions,
  MockFetchResponse,
  RetryOptions,
} from './orders.create.test-utils';
import { createFetchInspectors } from './orders.create.test-utils';

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

const { getLastFetchBody } = createFetchInspectors(mockFetchWithRetry);

describe('createOrder — savings credit', () => {
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

  it('forwards complete savings credit fields', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 720000,
        },
      ],
      payment_method: 'paystack',
      savings_amount: 500,
      savings_goal_id: ' 123e4567-e89b-12d3-a456-426614174555 ',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
      shipping_fee: 2000,
      subtotal: 720000,
      use_savings_credit: true,
    });

    const body = getLastFetchBody();
    expect(body.use_savings_credit).toBe(true);
    expect(body.savings_goal_id).toBe('123e4567-e89b-12d3-a456-426614174555');
    expect(body.savings_amount).toBe(500);
  });

  it('strips savings fields when the savings selection is incomplete', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
      payment_method: 'paystack',
      savings_amount: 500,
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
      shipping_fee: 500,
      subtotal: 5000,
      use_savings_credit: true,
    });

    const body = getLastFetchBody();
    expect(body).not.toHaveProperty('use_savings_credit');
    expect(body).not.toHaveProperty('savings_goal_id');
    expect(body).not.toHaveProperty('savings_amount');
  });

  it('rejects negative savings_amount at the schema boundary', async () => {
    const { createOrder } = require('./orders');

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        payment_method: 'paystack',
        savings_amount: -100,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
        shipping_fee: 500,
        subtotal: 5000,
        use_savings_credit: true,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects savings_amount above the mobile safety cap', async () => {
    const { createOrder } = require('./orders');

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        payment_method: 'paystack',
        savings_amount: 10_000_001,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
        shipping_fee: 500,
        subtotal: 5000,
        use_savings_credit: true,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
