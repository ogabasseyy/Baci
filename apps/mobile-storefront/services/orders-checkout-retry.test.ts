import { jest } from '@jest/globals';
import type { CreateOrderRequest } from './orders.schemas';

type MockAuthUserResponse = {
  data: { user: { id: string } | null };
  error: null;
};

type MockAuthSessionResponse = {
  data: { session: { access_token: string } | null };
};

const mockGetCheckoutAttemptKey = jest.fn<
  (payload: Record<string, unknown>, generation: string) => Promise<string>
>(async (payload, generation) => `${generation}:${String(payload.user_id)}`);

const mockGetUser = jest.fn<() => Promise<MockAuthUserResponse>>(async () => ({
  data: { user: null },
  error: null,
}));
const mockGetSession = jest.fn<() => Promise<MockAuthSessionResponse>>(
  async () => ({
    data: { session: null },
  })
);

jest.mock('@/lib/checkout-attempt-key', () => ({
  getCheckoutAttemptKey: mockGetCheckoutAttemptKey,
}));

jest.mock('@/lib/checkout-attempt-identity', () => ({
  persistCheckoutGeneration: jest.fn(async () => undefined),
  resolveCheckoutAuthPartition: jest.fn(
    async (_generation: string, currentUserId: string | undefined) =>
      currentUserId ?? 'guest'
  ),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => ({ checkoutGeneration: 'cart-one' }),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { merchantId: 'merchant-1', apiUrl: 'https://test.api' },
    },
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

jest.mock('./orders-auth', () => ({
  resolveCheckoutAuth: async () => ({
    authorizationHeaders: {},
    canValidateUser: false,
    session: null,
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
  },
  supabaseAuthStorage: {
    getItem: async () => null,
  },
  supabaseAuthStorageKey: 'auth-key',
}));

jest.mock('@/lib/api', () => ({
  fetchWithRetry: jest.fn(async () => ({
    ok: true,
    json: async () => ({
      amountDueToGateway: 5000,
      order: {
        created_at: '2026-09-10T00:00:00Z',
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'pending',
        shipping_status: 'pending',
        total: 5000,
      },
      wallet: null,
    }),
  })),
  DEFAULT_TIMEOUT: 30000,
  ApiError: class extends Error {},
  NetworkError: class extends Error {},
  RetryExhaustedError: class extends Error {},
  TimeoutError: class extends Error {},
}));

const request: CreateOrderRequest = {
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  customer_phone: '+2348012345678',
  items: [{ id: 'item-1', name: 'Buds', price: 5000, quantity: 1 }],
  payment_method: 'pay_on_delivery',
  shipping_address: {
    address: '1 St',
    city: 'Lagos',
    firstName: 'Ada',
    lastName: 'Okafor',
    state: 'Lagos',
  },
  shipping_fee: 0,
  source: 'mobile_app',
  subtotal: 5000,
};

describe('bugfix: checkout retries keep the originating auth partition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it('reuses the queued generation instead of the cart generation at replay', async () => {
    const { createOrder } = require('./orders') as typeof import('./orders');
    await createOrder(request, { checkoutGeneration: 'queued-cart' });
    expect(mockGetCheckoutAttemptKey).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'guest' }),
      'queued-cart'
    );
  });
});
