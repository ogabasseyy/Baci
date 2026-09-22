import { jest } from '@jest/globals';
import {
  CHECKOUT_AUTH_PARTITION_STORAGE_KEY,
  CHECKOUT_GENERATION_STORAGE_KEY,
} from '@/config/checkout-storage';
import type { CreateOrderRequest } from './orders';

// Lazily required after the mock consts initialize: a top-level import would
// evaluate the @/lib/api mock factory while the mock fns are still in TDZ.
function loadCreateOrder() {
  return require('./orders') as typeof import('./orders');
}

function loadOrderError() {
  return require('./orders.errors') as typeof import('./orders.errors');
}

const mockNetInfoFetch = jest.fn<() => Promise<{ isConnected: boolean }>>();
const mockSupabaseGetUser =
  jest.fn<
    () => Promise<{ data: { user: { id: string } | null }; error: null }>
  >();
const mockSupabaseGetSession =
  jest.fn<
    () => Promise<{ data: { session: { access_token: string } | null } }>
  >();
const mockFetchJson = jest.fn<() => Promise<unknown>>();
const mockFetchWithRetry =
  jest.fn<
    (
      url: string,
      options?: { body: string; headers?: Record<string, string> }
    ) => Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
      headers: { get: (name: string) => string | null };
    }>
  >();
const mockBuildSnapshottedOrderPayload =
  jest.fn<
    (
      input: Record<string, unknown>,
      checkoutGeneration: string
    ) => Promise<Record<string, unknown>>
  >();

let mockCartGeneration = 'stale-cart';

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
  useCartStore: {
    getState: () => ({ checkoutGeneration: mockCartGeneration }),
  },
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
  ApiError: class extends Error {},
  NetworkError: class extends Error {},
  RetryExhaustedError: class extends Error {},
  TimeoutError: class extends Error {},
}));

jest.mock('./orders-credit-freeze', () => ({
  buildSnapshottedOrderPayload: (
    input: Record<string, unknown>,
    checkoutGeneration: string
  ) => mockBuildSnapshottedOrderPayload(input, checkoutGeneration),
}));

const mockGetCheckoutAttemptKey = jest.fn<
  (...args: unknown[]) => Promise<string>
>(async () => 'mocked-idempotency-key');

jest.mock('@/lib/checkout-attempt-key', () => ({
  getCheckoutAttemptKey: (...args: unknown[]) =>
    mockGetCheckoutAttemptKey(...args),
}));

const mockReleaseCreditAfterDefinitiveRejection =
  jest.fn<(code: string, checkoutGeneration: string) => Promise<void>>();

jest.mock('./orders-credit-release', () => ({
  releaseCreditAfterDefinitiveRejection: (
    code: string,
    checkoutGeneration: string
  ) => mockReleaseCreditAfterDefinitiveRejection(code, checkoutGeneration),
}));

function validRequest(): CreateOrderRequest {
  return {
    customer_email: 'test@example.com',
    customer_name: 'Test User',
    customer_phone: '+2348012345678',
    items: [
      {
        id: 'line-1',
        product_id: 'buds2',
        name: 'Buds 2',
        price: 85000,
        quantity: 1,
      },
    ],
    subtotal: 85000,
    shipping_fee: 2000,
    payment_method: 'card',
    source: 'mobile',
    shipping_address: {
      firstName: 'Test',
      lastName: 'User',
      address: '123 St',
      city: 'Lagos',
      state: 'Lagos',
    },
  } as CreateOrderRequest;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCartGeneration = 'stale-cart';
  const { default: AsyncStorage } =
    require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  mockNetInfoFetch.mockResolvedValue({ isConnected: true });
  mockSupabaseGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockSupabaseGetSession.mockResolvedValue({
    data: { session: { access_token: 'token-123' } },
  });
  mockFetchJson.mockResolvedValue({
    order: {
      id: 'order-1',
      order_number: 'ORD-001',
      total: 87000,
      payment_status: 'unpaid',
      shipping_status: 'pending',
      created_at: '2026-03-31T00:00:00Z',
      tracking_token: null,
    },
    wallet: null,
    amountDueToGateway: 87000,
  });
  mockFetchWithRetry.mockResolvedValue({
    ok: true,
    status: 200,
    json: mockFetchJson,
    headers: { get: () => null },
  });
  mockBuildSnapshottedOrderPayload.mockImplementation(async (input) => ({
    ...(input.request as Record<string, unknown>),
  }));
  mockReleaseCreditAfterDefinitiveRejection.mockResolvedValue(undefined);
});

it('freezes the payload under the persisted generation when the cart is stale', async () => {
  const { default: AsyncStorage } =
    require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem(CHECKOUT_GENERATION_STORAGE_KEY, 'persisted-gen');
  await loadCreateOrder().createOrder(validRequest());
  expect(mockBuildSnapshottedOrderPayload).toHaveBeenCalledTimes(1);
  expect(mockBuildSnapshottedOrderPayload.mock.calls[0]?.[1]).toBe(
    'persisted-gen'
  );
});

it('maps snapshot failures to an OrderError instead of leaking plain errors', async () => {
  mockBuildSnapshottedOrderPayload.mockRejectedValueOnce(
    new Error('Checkout storage read timed out')
  );
  const failure = await loadCreateOrder()
    .createOrder(validRequest())
    .then(
      () => null,
      (error: unknown) => error
    );
  const { OrderError } = loadOrderError();
  expect(failure).toBeInstanceOf(OrderError);
  expect((failure as InstanceType<typeof OrderError>).code).toBe(
    'UNKNOWN_ERROR'
  );
});

it('releases the resolved snapshot after a definitive rejection with a stale cart', async () => {
  const { default: AsyncStorage } =
    require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem(CHECKOUT_GENERATION_STORAGE_KEY, 'persisted-gen');
  mockFetchWithRetry.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ error: 'bad request' }),
    headers: { get: () => null },
  });
  const failure = await loadCreateOrder()
    .createOrder(validRequest())
    .then(
      () => null,
      (error: unknown) => error
    );
  const { OrderError } = loadOrderError();
  expect(failure).toBeInstanceOf(OrderError);
  expect((failure as InstanceType<typeof OrderError>).code).toBe(
    'VALIDATION_ERROR'
  );
  expect(mockReleaseCreditAfterDefinitiveRejection).toHaveBeenCalledWith(
    'VALIDATION_ERROR',
    'persisted-gen'
  );
});

it('uses the restored durable generation for frozen UI retries started before rehydrate', async () => {
  const { default: AsyncStorage } =
    require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem(CHECKOUT_GENERATION_STORAGE_KEY, 'persisted-gen');
  mockCartGeneration = 'stale-cart';
  const { checkoutGenerationRestoreGate } =
    require('@/lib/checkout-generation-restore-gate') as typeof import('@/lib/checkout-generation-restore-gate');
  let releaseRestore!: () => void;
  const restoreSettled = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  checkoutGenerationRestoreGate.noteRestoreStarted(
    restoreSettled.then(() => {
      mockCartGeneration = 'persisted-gen';
      checkoutGenerationRestoreGate.noteRestoredGeneration('persisted-gen');
    })
  );

  const ordering = loadCreateOrder().createOrder(validRequest(), {
    checkoutGeneration: 'stale-cart',
  });
  releaseRestore();
  await ordering;

  expect(mockBuildSnapshottedOrderPayload.mock.calls[0]?.[1]).toBe(
    'persisted-gen'
  );
  expect(mockGetCheckoutAttemptKey.mock.calls[0]?.[1]).toBe('persisted-gen');
  expect(await AsyncStorage.getItem(CHECKOUT_GENERATION_STORAGE_KEY)).toBe(
    'persisted-gen'
  );
  expect(
    JSON.parse(
      (await AsyncStorage.getItem(CHECKOUT_AUTH_PARTITION_STORAGE_KEY)) ?? '{}'
    ) as Record<string, string>
  ).toEqual({ 'persisted-gen': 'guest' });
});
