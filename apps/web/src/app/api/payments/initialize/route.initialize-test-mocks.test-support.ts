import { vi } from 'vitest';
import {
  createMockAdminClient,
  createMockSupabase,
} from './route.initialize-test-fixtures.test-support';

const routeMocks = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  getRedvaultPaymentAvailability: vi.fn(),
  getRedvaultLivePilotPolicy: vi.fn(),
  getRedvaultCheckoutSummary: vi.fn(),
}));

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

vi.mock('nanoid', () => ({
  customAlphabet: () => () => 'ABCD12345678',
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: routeMocks.authenticateApiRequest,
}));

vi.mock('@/lib/checkout/redvault-payment-availability', () => ({
  getRedvaultPaymentAvailability: routeMocks.getRedvaultPaymentAvailability,
}));

vi.mock('@/lib/checkout/redvault-live-pilot', () => ({
  getRedvaultLivePilotPolicy: routeMocks.getRedvaultLivePilotPolicy,
  REDVAULT_PILOT_USER_ID: '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
}));

vi.mock('@/lib/checkout/get-redvault-checkout-summary', () => ({
  getRedvaultCheckoutSummary: routeMocks.getRedvaultCheckoutSummary,
}));

// Juicyway mocks
const mockInitializeJuicyway = vi.fn();
const mockCapturePaymentWithCrypto = vi.fn();
const mockGetPaymentSession = vi.fn();
const mockGetPayment = vi.fn();

vi.mock('@/lib/juicyway', () => ({
  initializePayment: (...args: unknown[]) => mockInitializeJuicyway(...args),
  capturePaymentWithCrypto: (...args: unknown[]) =>
    mockCapturePaymentWithCrypto(...args),
  getPaymentSession: (...args: unknown[]) => mockGetPaymentSession(...args),
  getPayment: (...args: unknown[]) => mockGetPayment(...args),
  extractCryptoAddress: (pm: Record<string, unknown> | null | undefined) => {
    if (!pm) return null;
    const addr =
      (pm.address as string) || (pm.params as { address?: string })?.address;
    if (!addr) return null;
    return {
      address: addr,
      chain: pm.chain || (pm.params as { chain?: string })?.chain || '',
      currency:
        pm.currency || (pm.params as { currency?: string })?.currency || '',
      qrcode: pm.qrcode,
    };
  },
  convertNgnKoboToUsdtCents: async (ngnKobo: number) => ({
    usdtCents: Math.ceil((ngnKobo / 100 / 1535) * 100),
    rate: 1535,
    ngnAmount: ngnKobo / 100,
  }),
  formatPhoneToE164: (phone: string) => {
    const trimmed = phone.trim();
    if (trimmed.startsWith('+')) {
      return `+${trimmed.slice(1).replace(/\D/g, '')}`;
    }
    return `+234${trimmed.replace(/^0/, '').replace(/\D/g, '')}`;
  },
  generatePaymentReference: () => 'baci_test_ref123',
  getChainConfirmationTime: () => '1-3 minutes',
  isSupportedCurrency: (c: string) =>
    ['NGN', 'USD', 'USDT', 'USDC'].includes(c),
  JUICYWAY_CHAIN_SUPPORT: {
    USDT: ['TRX', 'ETH'],
    USDC: ['ETH', 'MATIC', 'AVAXC'],
  },
}));

// Korapay mocks
const mockInitializeKorapay = vi.fn();
// Spy so tests can assert the fee helper receives the RESOLVED order currency —
// reverting the route to calculateKorapayFee(data.amount) would otherwise leave
// the suite green and reintroduce the foreign-currency fee bug.
const mockKorapayCalculatePlatformFee = vi.fn(
  (amount: number, _currency?: string) => ({
    platformFee: amount * 0.015,
    merchantAmount: amount * 0.985,
  })
);
vi.mock('@/lib/korapay', () => ({
  initializePayment: (...args: unknown[]) => mockInitializeKorapay(...args),
  calculatePlatformFee: (...args: [number, string?]) =>
    mockKorapayCalculatePlatformFee(...args),
  // Mirror the real korapay multi-currency support list so the
  // resolve-charge-currency helper (imported by the route) sees the same
  // gateway-support surface as production.
  SUPPORTED_CURRENCIES: ['NGN', 'KES', 'GHS', 'ZAR', 'XAF', 'XOF'],
}));

// Paystack mocks
const mockInitializePaystack = vi.fn();
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: (...args: unknown[]) =>
    mockInitializePaystack(...args),
  calculatePlatformFee: (amount: number) => ({
    platformFee: Math.round(amount * 0.015),
    merchantAmount: amount - Math.round(amount * 0.015),
  }),
}));

const mockCreateDedicatedVirtualAccount = vi.fn();
vi.mock('@/lib/agentic/paystack', () => ({
  createDedicatedVirtualAccount: (...args: unknown[]) =>
    mockCreateDedicatedVirtualAccount(...args),
}));

// Logger mocks cover both recoverable warnings and fail-closed DVA persistence.
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerDebug = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
  },
}));

// Supabase mocks
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    ...createMockSupabase(),
    ...createMockAdminClient(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    ...createMockSupabase(),
    ...createMockAdminClient(),
  }),
}));

// Dynamic import AFTER the mocks register (never a static re-export:
// that would evaluate the real modules before the mock factories run).
export const { POST } = await import('./route');

export {
  mockCreateDedicatedVirtualAccount,
  mockInitializePaystack,
  routeMocks,
};
