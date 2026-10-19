// Shared mocks for the focused loyalty-checkout suite (issue #3165).
// Mirrors the registrations in route.test.ts; POST is re-exported
// after the mocks register (same pattern as
// route.order-test-mocks.test-support.ts).

import { vi } from 'vitest';

const mockCreateAdminClient = vi.hoisted(() => vi.fn());
const mockCreateLoyaltyResolverServiceClient = vi.hoisted(() => vi.fn());
const mockAfter = vi.hoisted(() => vi.fn((cb: () => unknown) => cb()));

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://mock.supabase.co',
  getSupabaseAnonKey: () => 'mock-key',
  getSupabaseServiceRoleKey: () => 'mock-service-key',
  getRootDomain: () => 'localhost:3000',
  getQuizPhaseEnv: () => '1a',
  getQuizProductionApprovedEnv: () => false,
  getQuizRpcServerSecret: () => undefined,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  hasPermission: vi.fn(() => true),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
}));

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: mockAfter };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Issue #3696: resolveLoyaltyCheckoutCode builds its own branded
// resolver client (the resolver RPC lost anon EXECUTE), so the
// harness wires the branded factory to an override-driven fake too.
vi.mock('@/lib/loyalty/server-resolver-client', () => ({
  createLoyaltyResolverServiceClient: mockCreateLoyaltyResolverServiceClient,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: vi.fn(
    ({ fallbackClient }: { fallbackClient: unknown }) => fallbackClient
  ),
}));

vi.mock('@/lib/geo-privacy', () => ({
  detectPrivacyRegion: vi.fn().mockResolvedValue({
    country: 'NG',
    region: 'Lagos',
    shouldApplyLDU: false,
  }),
}));

vi.mock('@/lib/quiz-compliance-gate', () => ({
  enforcePrizeProductionGuard: vi.fn(),
  QuizProductionNotApprovedError: class QuizProductionNotApprovedError extends Error {},
}));

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(() => '<html />'),
  generateOrderConfirmationText: vi.fn(() => 'text'),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyNewInvoice: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
  notifyNewOrder: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
  notifyPaymentReceived: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('@/lib/payments/record-pre-gateway-redemption', () => ({
  recordPreGatewayRedemption: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/immediate-order/notification-completion-proof', () => ({
  createImmediateNotificationCompletionProof: () => 'proof-route-1',
}));

vi.mock('@/lib/immediate-order/notification-completion-retry', () => ({
  completeNotificationWithProvisioningRetry: vi.fn(async () => ({
    completed: true,
  })),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: vi.fn(() =>
    Promise.resolve({ success: true, data: {} })
  ),
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(() => new Blob(['branded-invoice'])),
  resolveReceiptLogoDataUri: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: vi.fn(() => ({})),
}));

vi.mock('@/lib/payments/reserve-paystack-dva-assignment', () => ({
  reservePaystackDvaAssignment: vi.fn(async () => ({
    data: 'inserted',
    error: null,
  })),
}));

vi.mock('@/lib/payments/persist-paystack-dva-assignment', () => ({
  persistPaystackDvaAssignment: vi.fn(async () => ({
    data: null,
    error: null,
  })),
}));

vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: { getLocations: vi.fn().mockResolvedValue([]) },
}));

// Dynamic import AFTER the mocks register (never a static re-export:
// the route module must evaluate after the mock factory installs).
export const { POST } = await import('./route');
export const { authenticateApiRequest } = await import('@/lib/api-auth');
export const { NextRequest } = await import('next/server');
export { mockCreateAdminClient, mockCreateLoyaltyResolverServiceClient };
