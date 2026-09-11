import { jest } from '@jest/globals';
import type { CreateOrderRequest } from './orders';

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

type TestOrderItem = CreateOrderRequest['items'][number];

function getLastFetchCall(): [string, MockFetchOptions] {
  const fetchCall = mockFetchWithRetry.mock.calls.at(-1) as
    | [string, MockFetchOptions]
    | undefined;

  if (!fetchCall) {
    throw new Error(
      'Expected fetchWithRetry to be called before reading the request body'
    );
  }

  if (!fetchCall[1]?.body) {
    throw new Error(
      `Expected fetchWithRetry to be called with a JSON body, received: ${JSON.stringify(fetchCall)}`
    );
  }

  return fetchCall;
}

function getLastFetchOptions(): MockFetchOptions {
  const [, options] = getLastFetchCall();
  return options;
}

async function createOrderWithItems(items: TestOrderItem[]) {
  const { createOrder } = require('./orders') as typeof import('./orders');

  await createOrder({
    customer_email: 'test@example.com',
    customer_name: 'Test User',
    customer_phone: '+2348012345678',
    items,
    subtotal: items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    ),
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
  });
}

describe('createOrder checkout retry keys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchResponse.ok = true;
    mockFetchResponse.status = 200;
  });
  it('reuses the order key after returning from an unpaid payment attempt', async () => {
    const items = [
      { id: 'buds2', name: 'Samsung Galaxy Buds2', price: 85000, quantity: 1 },
    ];
    await createOrderWithItems(items);
    const firstKey = getLastFetchOptions().headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    await createOrderWithItems(items);
    expect(getLastFetchOptions().headers?.['Idempotency-Key']).toBe(firstKey);
  });

  it('reuses the order key when the first response is lost', async () => {
    const items = [
      { id: 'buds2', name: 'Samsung Galaxy Buds2', price: 85000, quantity: 1 },
    ];
    mockFetchWithRetry.mockRejectedValueOnce(
      new Error('Network request failed')
    );
    await expect(createOrderWithItems(items)).rejects.toThrow();
    const firstKey = getLastFetchOptions().headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    await createOrderWithItems(items);
    expect(getLastFetchOptions().headers?.['Idempotency-Key']).toBe(firstKey);
  });
});
