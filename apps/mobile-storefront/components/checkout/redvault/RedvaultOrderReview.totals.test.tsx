import { jest } from '@jest/globals';
import type { ReactNode } from 'react';
import { createOrder } from '@/services/orders';
import type { FetchImplementation } from '@/types/fetch';
import {
  redvaultOrderRequest as request,
  redvaultOrderResponse as responseBody,
} from './redvault-order-review.test-utils';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/ModalSheet', () => ({
  ModalSheet: ({
    children,
    visible,
  }: {
    children: ReactNode;
    visible: boolean;
  }) => (visible ? children : null),
}));
jest.mock('@/services/orders-auth', () => ({
  resolveCheckoutAuth: async () => ({
    authorizationHeaders: { Authorization: 'Bearer customer-token' },
    canValidateUser: false,
    session: null,
  }),
}));
jest.mock('@/services/read-checkout-stored-session', () => ({
  readCheckoutStoredSession: async () => ({ session: null, timedOut: false }),
}));
jest.mock('@/lib/resolve-checkout-auth-partition', () => ({
  resolveCheckoutAuthPartition: async () => 'guest',
}));
jest.mock('@/lib/checkout-attempt-key', () => ({
  getCheckoutAttemptKey: async (_payload: unknown, generation: string) =>
    generation,
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: () => ({ checkoutGeneration: 'cart-one' }) },
}));
jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { enqueue: jest.fn() },
}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true }),
}));
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        apiUrl: 'https://ogabassey.example',
      },
    },
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: {} },
  supabaseAuthStorage: {},
  supabaseAuthStorageKey: 'test',
}));
jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
  trackError: jest.fn(),
  trackCheckoutPaymentStarted: jest.fn(),
}));

const mockFetch = jest.fn<FetchImplementation>();
let initializationStatus = 200;
let orderBody: unknown = responseBody;
beforeEach(() => {
  jest.clearAllMocks();
  initializationStatus = 200;
  orderBody = responseBody;
  global.fetch = mockFetch;
  mockFetch.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith('/availability')
      ? { available: true, reason: 'ready' }
      : path === '/api/orders'
        ? orderBody
        : initializationStatus === 202
          ? { code: 'REDVAULT_RECONCILIATION_REQUIRED' }
          : {
              success: true,
              authorization_url: 'https://checkout.paystack.com/test',
              reference: 'RV-test',
            };
    return {
      ok: path.endsWith('/initialize') ? initializationStatus < 400 : true,
      status: path.endsWith('/initialize') ? initializationStatus : 200,
      headers: new Headers(),
      json: async () => body,
      clone: () => ({ json: async () => body }),
    } as Response;
  });
});

it('rejects incomplete persisted totals before a payment can start', async () => {
  orderBody = {
    ...responseBody,
    redvault: { status: 'pending', quote: { discount_kobo: 500 } },
  };
  await expect(createOrder(request)).rejects.toMatchObject({
    code: 'RESPONSE_VALIDATION_ERROR',
  });
  expect(
    mockFetch.mock.calls.some(([url]) => String(url).endsWith('/initialize'))
  ).toBe(false);
});
