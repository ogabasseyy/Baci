import { vi } from 'vitest';

// Shared module mocks for split POST /api/orders suites, mirroring the
// coverage the monolithic route.test.ts applies so extracted suites keep
// identical route behavior.
const {
  MockQuizProductionNotApprovedError,
  mockNotifyNewInvoice,
  mockEnforcePrizeProductionGuard,
  mockNotifyNewOrder,
  mockNotifyPaymentReceived,
  mockSendEmail,
  mockAfter,
  mockGeneratePaymentAccount,
  mockGenerateReceiptBlob,
  mockResolveReceiptLogoDataUri,
  mockCreateAdminClient,
  mockCreateQuizRpcServerProof,
  mockRevalidateProducts,
  mockRevalidateProductSlugs,
} = vi.hoisted(() => ({
  MockQuizProductionNotApprovedError: class MockQuizProductionNotApprovedError extends Error {
    code = 'quiz_production_not_approved' as const;
    status = 403 as const;

    constructor() {
      super('quiz_production_not_approved');
      this.name = 'QuizProductionNotApprovedError';
    }
  },
  mockNotifyNewInvoice: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
  mockEnforcePrizeProductionGuard: vi.fn(),
  mockNotifyNewOrder: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
  mockNotifyPaymentReceived: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
  mockSendEmail: vi.fn(() => Promise.resolve({ success: true })),
  mockAfter: vi.fn((cb: () => unknown) => cb()),
  mockGeneratePaymentAccount: vi.fn(
    ():
      | Promise<{
          success: true;
          data: {
            bank_name: string;
            account_number: string;
            account_name: string;
            customer_code: string;
          };
        }>
      | Promise<{ success: false; error: string }> =>
      Promise.resolve({
        success: true,
        data: {
          bank_name: 'Wema Bank',
          account_number: '1234567890',
          account_name: 'OgaBassey-Test',
          customer_code: 'CUS_mock',
        },
      })
  ),
  mockGenerateReceiptBlob: vi.fn(() => new Blob(['branded-invoice'])),
  mockResolveReceiptLogoDataUri: vi.fn(
    (): Promise<string | null> => Promise.resolve(null)
  ),
  mockCreateAdminClient: vi.fn(),
  mockCreateQuizRpcServerProof: vi.fn(
    ({
      action,
      payload,
      subjectId,
      userId,
    }: {
      action: string;
      payload: Record<string, unknown>;
      subjectId: string;
      userId: string;
    }) => ({
      action,
      issued_at: '2026-08-28T00:00:00.000Z',
      payload,
      payload_hash: 'a'.repeat(64),
      proof_id: 'proof-test',
      scope: 'quiz_phase1a',
      signature: 'b'.repeat(64),
      subject_id: subjectId,
      user_id: userId,
      version: 'quiz-rpc-proof:v1',
    })
  ),
  mockRevalidateProducts: vi.fn(),
  mockRevalidateProductSlugs: vi.fn(),
}));

export { mockCreateAdminClient };

const mockPersistPaystackDvaAssignment = vi.hoisted(() => vi.fn());
const mockRecordPreGatewayRedemption = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
const retryMocks = vi.hoisted(() => ({
  completeWithRetry: vi.fn(async () => ({ completed: true })),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mockRevalidateProducts,
  revalidateProductSlugs: mockRevalidateProductSlugs,
}));

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: mockGeneratePaymentAccount,
}));

vi.mock(
  '@/lib/payments/persist-paystack-dva-assignment',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/payments/persist-paystack-dva-assignment')
      >();
    mockPersistPaystackDvaAssignment.mockImplementation(
      (...args: Parameters<typeof actual.persistPaystackDvaAssignment>) =>
        actual.persistPaystackDvaAssignment(...args)
    );
    return {
      ...actual,
      persistPaystackDvaAssignment: mockPersistPaystackDvaAssignment,
    };
  }
);

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: mockGenerateReceiptBlob,
  resolveReceiptLogoDataUri: mockResolveReceiptLogoDataUri,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://mock.supabase.co',
  getSupabaseAnonKey: () => 'mock-key',
  getSupabaseServiceRoleKey: () => 'mock-service-key',
  getRootDomain: () => 'localhost:3000',
  getQuizPhaseEnv: () => process.env.QUIZ_PHASE ?? '1a',
  getQuizProductionApprovedEnv: () => {
    const normalized =
      process.env.QUIZ_PRODUCTION_APPROVED?.trim().toLowerCase() ?? '';
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  },
  getQuizRpcServerSecret: () => process.env.QUIZ_RPC_SERVER_SECRET,
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

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(() => '<html />'),
  generateOrderConfirmationText: vi.fn(() => 'text'),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyNewInvoice: mockNotifyNewInvoice,
  notifyNewOrder: mockNotifyNewOrder,
  notifyPaymentReceived: mockNotifyPaymentReceived,
}));

vi.mock('@/lib/zeptomail', () => ({ sendEmail: mockSendEmail }));

vi.mock('@/lib/payments/record-pre-gateway-redemption', () => ({
  recordPreGatewayRedemption: mockRecordPreGatewayRedemption,
}));

vi.mock('@/lib/geo-privacy', () => ({
  detectPrivacyRegion: vi.fn().mockResolvedValue({
    country: 'NG',
    region: 'Lagos',
    shouldApplyLDU: false,
  }),
}));

vi.mock('@/lib/quiz-compliance-gate', () => ({
  enforcePrizeProductionGuard: mockEnforcePrizeProductionGuard,
  QuizProductionNotApprovedError: MockQuizProductionNotApprovedError,
}));

vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: vi.fn(
    ({ fallbackClient }: { fallbackClient: unknown }) => fallbackClient
  ),
}));

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: mockCreateQuizRpcServerProof,
}));

vi.mock('@/lib/payments/reserve-paystack-dva-assignment', () => ({
  reservePaystackDvaAssignment: vi.fn(async () => ({
    data: 'inserted',
    error: null,
  })),
}));

vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: { getLocations: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/immediate-order/notification-completion-proof', () => ({
  createImmediateNotificationCompletionProof: () => 'proof-route-1',
}));

vi.mock('@/lib/immediate-order/notification-completion-retry', () => ({
  completeNotificationWithProvisioningRetry: retryMocks.completeWithRetry,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// Dynamic imports AFTER the mocks register (never static re-exports:
// those would evaluate the real modules before the mock factories run).
export const { POST } = await import('./route');
export const { authenticateApiRequest } = await import('@/lib/api-auth');
export const { NextRequest } = await import('next/server');
