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

const { getLastFetchBody, getLastFetchOptions } =
  createFetchInspectors(mockFetchWithRetry);

describe('createOrder — session and idempotency', () => {
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

  it('supports guest checkout when no authenticated session is present', async () => {
    const { createOrder } = require('./orders');

    mockSupabaseGetSession.mockResolvedValueOnce({
      data: { session: null },
    });
    mockSupabaseGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await createOrder({
      customer_email: 'guest@example.com',
      customer_name: 'Guest User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-guest-1',
          name: 'Guest Checkout Item',
          quantity: 1,
          price: 120000,
        },
      ],
      subtotal: 120000,
      shipping_fee: 2000,
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Guest',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    expect(getLastFetchOptions()?.headers).not.toHaveProperty('Authorization');

    const body = getLastFetchBody();
    expect(body).not.toHaveProperty('user_id');
    expect(body.payment_method).toBe('pay_on_delivery');
  });

  it('uses a caller-provided idempotency key header without serializing it into the order body', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
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
    });

    expect(getLastFetchOptions().headers?.['Idempotency-Key']).toBe(
      'mobile-bnpl-key-1'
    );
    expect(getLastFetchBody()).not.toHaveProperty('idempotency_key');
  });

  it('includes the selected shipping quote metadata in the API payload', async () => {
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
      subtotal: 720000,
      shipping_fee: 3638,
      tax_amount: 54000,
      selected_quote_id: '98dd0f44-d780-4829-9163-3e8a088dcf95',
      shipping_provider: 'TOPSHIP',
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.selected_quote_id).toBe('98dd0f44-d780-4829-9163-3e8a088dcf95');
    expect(body.shipping_provider).toBe('TOPSHIP');
  });

  it('passes maxRetries: 0 to fetchWithRetry so orders are never automatically retried', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
      subtotal: 5000,
      shipping_fee: 500,
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const retryOptions = mockFetchWithRetry.mock.calls.at(-1)?.[2];
    expect(retryOptions?.maxRetries).toBe(0);
  });
});
