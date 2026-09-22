import { jest } from '@jest/globals';
import type {
  MockAuthSessionResponse,
  MockAuthUserResponse,
  MockCreateOrderApiResponse,
  MockFetchOptions,
  MockFetchResponse,
  RetryOptions,
} from './orders.create.test-utils';
import {
  createFetchInspectors,
  createOrderWithItems,
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

const { getLastFetchBody } = createFetchInspectors(mockFetchWithRetry);

describe('createOrder — quiz vouchers', () => {
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

  it('forwards a trimmed voucher_token for token-only quiz voucher items', async () => {
    await createOrderWithItems([
      {
        id: 'prod-1',
        product_id: 'prod-1',
        name: 'Quiz Voucher Item',
        quantity: 1,
        price: 0,
        voucher_token: '  voucher-token-1  ',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0].voucher_token).toBe('voucher-token-1');
    expect(body.items[0]).not.toHaveProperty('voucher_award_id');
  });

  it('accepts a realistic-length quiz voucher token (>128 chars)', async () => {
    // Real tokens are qv1.<base64url payload>.<base64url HMAC> ~250-400 chars.
    // The old 128 cap rejected every real token client-side before send.
    const realisticToken = `qv1.${'A'.repeat(220)}.${'B'.repeat(43)}`;
    expect(realisticToken.length).toBeGreaterThan(128);

    await createOrderWithItems([
      {
        id: 'prod-1',
        product_id: 'prod-1',
        name: 'Quiz Voucher Item',
        quantity: 1,
        price: 0,
        voucher_token: realisticToken,
        voucher_award_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0].voucher_token).toBe(realisticToken);
  });

  it('rejects blank voucher_token values after trimming', async () => {
    await expect(
      createOrderWithItems([
        {
          id: 'prod-1',
          product_id: 'prod-1',
          name: 'Quiz Voucher Item',
          quantity: 1,
          price: 0,
          voucher_token: '   ',
        },
      ])
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('Voucher token'),
    });

    expect(mockFetchWithRetry).not.toHaveBeenCalled();
  });

  it('forwards a trimmed voucher_award_id for award-id-only quiz voucher items', async () => {
    await createOrderWithItems([
      {
        id: 'prod-1',
        product_id: 'prod-1',
        name: 'Quiz Voucher Item',
        quantity: 1,
        price: 0,
        voucher_award_id: '  voucher-award-1  ',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0]).not.toHaveProperty('voucher_token');
    expect(body.items[0].voucher_award_id).toBe('voucher-award-1');
  });

  it('rejects blank voucher_award_id values after trimming', async () => {
    await expect(
      createOrderWithItems([
        {
          id: 'prod-1',
          product_id: 'prod-1',
          name: 'Quiz Voucher Item',
          quantity: 1,
          price: 0,
          voucher_award_id: '   ',
        },
      ])
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('Voucher award ID'),
    });

    expect(mockFetchWithRetry).not.toHaveBeenCalled();
  });

  it('serializes voucher identifiers across mixed multi-item carts', async () => {
    await createOrderWithItems([
      {
        id: 'prod-paid-1',
        product_id: 'prod-paid-1',
        name: 'Paid Item',
        quantity: 1,
        price: 720000,
      },
      {
        id: 'prod-voucher-token',
        product_id: 'prod-voucher-token',
        name: 'Token Voucher Item',
        quantity: 1,
        price: 0,
        voucher_token: 'voucher-token-2',
        voucher_award_id: 'voucher-award-2',
      },
      {
        id: 'prod-voucher-award',
        product_id: 'prod-voucher-award',
        name: 'Award Only Voucher Item',
        quantity: 1,
        price: 0,
        voucher_award_id: 'voucher-award-3',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0]).not.toHaveProperty('voucher_token');
    expect(body.items[0]).not.toHaveProperty('voucher_award_id');
    expect(body.items[1].voucher_token).toBe('voucher-token-2');
    expect(body.items[1].voucher_award_id).toBe('voucher-award-2');
    expect(body.items[2]).not.toHaveProperty('voucher_token');
    expect(body.items[2].voucher_award_id).toBe('voucher-award-3');
  });
});
