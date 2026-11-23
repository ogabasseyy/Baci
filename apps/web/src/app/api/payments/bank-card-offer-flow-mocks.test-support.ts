import { afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  initialize: vi.fn(),
  verify: vi.fn(),
  refund: vi.fn(),
  cookieAuth: vi.fn(),
  csrf: vi.fn(),
}));
vi.mock('@/lib/go54', () => ({
  isGo54Configured: () => false,
  registerDomain: vi.fn(),
}));
vi.mock('@/env', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  env: {
    get PAYSTACK_SECRET_KEY() {
      return process.env.PAYSTACK_SECRET_KEY;
    },
  },
  getSupabaseUrl: () => 'https://synthetic.example.test',
  getSupabaseAnonKey: () => 'synthetic',
}));
vi.mock('next/server', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  after: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: async () => ({ user: { id: userId } }),
}));
vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: mocks.cookieAuth,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.csrf,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => mocks }));
vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: () => mocks,
}));
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: mocks.initialize,
  verifyTransaction: mocks.verify,
  calculatePlatformFee: () => ({ platformFee: 100, merchantAmount: 9400 }),
}));
vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.refund,
}));
vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: async () => [],
}));
vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: async () => ({
    failedSteps: [],
    ranSteps: [],
    skippedSteps: [],
    concurrentTakeoverSteps: [],
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

export const userId = 'c4c9b190-6486-418a-8f68-dce9269e0eac';
export { mocks };
