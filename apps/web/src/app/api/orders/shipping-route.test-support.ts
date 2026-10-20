import { vi } from 'vitest';

const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  hasPermission: vi.fn(() => true),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
}));
vi.mock('next/server', async () => ({
  ...(await vi.importActual<typeof import('next/server')>('next/server')),
  // Shipping assertions stop at the order RPC boundary; background delivery
  // is covered by the legacy route suite and cannot send from these fixtures.
  after: vi.fn(),
}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://mock.supabase.co',
  getSupabaseAnonKey: () => 'mock-key',
  getSupabaseServiceRoleKey: () => 'mock-service-key',
  getRootDomain: () => 'localhost:3000',
  getQuizPhaseEnv: () => '1a',
  getQuizProductionApprovedEnv: () => false,
  getQuizRpcServerSecret: () => undefined,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: { getLocations: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: ({
    fallbackClient,
  }: {
    fallbackClient: unknown;
  }) => fallbackClient,
}));
vi.mock('@/lib/geo-privacy', () => ({
  detectPrivacyRegion: vi.fn().mockResolvedValue({
    country: 'NG',
    region: 'Lagos',
    shouldApplyLDU: false,
  }),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/paystack', () => ({ generatePaymentAccount: vi.fn() }));
vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(() => new Blob(['branded-invoice'])),
  resolveReceiptLogoDataUri: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(() => '<html />'),
  generateOrderConfirmationText: vi.fn(() => 'text'),
}));
vi.mock('@/lib/expo-push', () => ({
  notifyNewInvoice: vi.fn(),
  notifyNewOrder: vi.fn(),
  notifyPaymentReceived: vi.fn(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
}));

export { mockCreateAdminClient };
