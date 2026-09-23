import { jest } from '@jest/globals';
import type { Session } from '@supabase/supabase-js';
import { sessionFixture } from './orders-auth-fallback.test-utils';

const userAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mockGetUser = jest.fn<
  (jwt?: string) => Promise<{
    data: { user: { id: string } | null };
    error: Error | null;
  }>
>(() => new Promise<never>(() => undefined));
const mockGetSession =
  jest.fn<() => Promise<{ data: { session: Session | null } }>>();
const mockRefreshSession = jest.fn<
  () => Promise<{
    data: { session: Session | null };
    error: Error | null;
  }>
>(() => new Promise<never>(() => undefined));
const mockFetchWithRetry = jest.fn<
  (
    url: string,
    init: { body: string; headers: Record<string, string> },
    options: unknown
  ) => Promise<unknown>
>(async () => ({
  headers: {
    get: () => null,
  },
  json: async () => ({
    amountDueToGateway: 102_000,
    order: {
      created_at: '2026-08-30T00:00:00Z',
      id: 'order-1',
      order_number: 'ORD-001',
      payment_status: 'unpaid',
      shipping_status: 'pending',
      total: 102_000,
      tracking_token: null,
    },
    wallet: null,
  }),
  ok: true,
  status: 200,
}));

const orderRequest = {
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  customer_phone: '+2348012345678',
  items: [
    {
      id: 'product-1',
      name: 'Phone',
      price: 100_000,
      quantity: 1,
    },
  ],
  payment_method: 'card' as const,
  shipping_address: {
    address: '1 Test Street',
    city: 'Lagos',
    firstName: 'Test',
    lastName: 'Buyer',
    state: 'Lagos',
  },
  shipping_fee: 2_000,
  source: 'mobile' as const,
  subtotal: 100_000,
};

jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => ({ checkoutGeneration: 'cart-one' }),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = new Map<string, string>();
  return {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
}));

jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { apiUrl: 'https://test.api', merchantId: 'merchant-1' },
    },
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { enqueue: jest.fn() },
}));

jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      refreshSession: mockRefreshSession,
    },
  },
  supabaseAuthStorage: {},
  supabaseAuthStorageKey: 'auth-key',
}));

jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  DEFAULT_TIMEOUT: 30_000,
  NetworkError: class extends Error {},
  RetryExhaustedError: class extends Error {},
  TimeoutError: class extends Error {},
  fetchWithRetry: mockFetchWithRetry,
}));

jest.mock('./orders-session', () => ({
  getCheckoutStoredSession: async () => (await mockGetSession()).data.session,
}));

jest.mock('./read-checkout-stored-session', () => ({
  readCheckoutStoredSession: async () => {
    const { data } = await mockGetSession();
    return { session: data.session, timedOut: false };
  },
}));

const { createOrder } =
  jest.requireActual<typeof import('./orders')>('./orders');

describe('createOrder checkout retry key after validation timeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockImplementation(() => new Promise<never>(() => undefined));
    mockRefreshSession.mockImplementation(
      () => new Promise<never>(() => undefined)
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the retry key when user validation recovers after a timeout', async () => {
    jest.useFakeTimers();
    const session = sessionFixture('token', 'refresh-token');
    mockGetSession.mockResolvedValue({ data: { session } });
    mockRefreshSession.mockResolvedValue({ data: { session }, error: null });
    const first = createOrder(orderRequest);
    await jest.advanceTimersByTimeAsync(4_000);
    await first;
    const firstKey =
      mockFetchWithRetry.mock.calls[0]?.[1]?.headers['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userAId } },
      error: null,
    });
    await createOrder(orderRequest);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
    expect(
      mockFetchWithRetry.mock.calls[1]?.[1]?.headers['Idempotency-Key']
    ).toBe(firstKey);
  });
});
