import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

const routeMocks = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  getRedvaultPaymentAvailability: vi.fn(),
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
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const ORDER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

let rpcResult: { data: unknown; error: unknown };
let rpcTransactionResult: { data: unknown; error: unknown };
let rpcDvaReservationResult: { data: unknown; error: unknown };
let redvaultAttemptInitializeResult: { data: unknown; error: unknown };
let redvaultAttemptClaimResults: Array<{ data: unknown; error: unknown }>;
let redvaultAttemptReserveResults: Array<{ data: unknown; error: unknown }>;
const rpcCalls: Array<{ args?: unknown; name: string }> = [];

function createMockSupabase() {
  return {
    rpc: vi.fn((name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'get_order_payment_snapshot')
        return Promise.resolve(rpcResult);
      if (name === 'create_payment_transaction')
        return Promise.resolve(rpcTransactionResult);
      if (name === 'reserve_paystack_order_payment_account')
        return Promise.resolve(rpcDvaReservationResult);
      if (name === 'reserve_storefront_redvault_payment_attempt')
        return Promise.resolve(redvaultAttemptReserveResults.shift());
      if (name === 'claim_storefront_redvault_payment_attempt_initialization')
        return Promise.resolve(redvaultAttemptClaimResults.shift());
      if (name === 'record_storefront_redvault_payment_attempt_initialization')
        return Promise.resolve(redvaultAttemptInitializeResult);
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

let merchantResult: { data: unknown; error: unknown };
let featureSettingsResult: { data: unknown; error: unknown };
let orderPaymentResult: { data: unknown; error: unknown };
let savingsRedemptionsResult: { data: unknown; error: unknown };

function createMockAdminClient() {
  return {
    from: (table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(merchantResult),
            }),
          }),
        };
      }
      if (table === 'merchant_feature_settings') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve(featureSettingsResult),
            }),
          }),
        };
      }
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve(orderPaymentResult),
              }),
            }),
          }),
        };
      }
      if (table === 'customer_savings_redemptions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve(savingsRedemptionsResult),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  };
}

// Admin client is used for all Supabase operations (mobile Bearer-token compat).
// The mock returns separate sub-clients so RPC calls (snapshot, transaction)
// and table queries (merchants, feature_settings) can be controlled independently.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    ...createMockSupabase(),
    ...createMockAdminClient(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createMockSupabase(),
}));

// ---- Import handler AFTER mocks ----
import { POST } from './route';

// ---- Helpers ----

const validBody = {
  merchant_id: MERCHANT_ID,
  order_id: ORDER_ID,
  amount: 5000,
  currency: 'NGN',
  customer_email: 'customer@example.com',
  customer_name: 'John Doe',
  customer_phone: '08012345678',
  billing_address: {
    line1: '123 Main St',
    city: 'Lagos',
    country: 'NG',
    zip_code: '100001',
  },
};

function makeRequest(
  body: Record<string, unknown>,
  init?: { headers?: Record<string, string>; url?: string }
) {
  return new NextRequest(
    init?.url || 'http://localhost:3000/api/payments/initialize',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      body: JSON.stringify(body),
    }
  );
}

function setupDefaults() {
  rpcResult = {
    data: [
      {
        merchant_id: MERCHANT_ID,
        total: 5000,
        tracking_token: 'track-token-123',
      },
    ],
    error: null,
  };
  rpcTransactionResult = { data: null, error: null };
  rpcDvaReservationResult = { data: 'inserted', error: null };
  redvaultAttemptInitializeResult = { data: null, error: null };
  redvaultAttemptClaimResults = [];
  redvaultAttemptReserveResults = [];
  merchantResult = {
    data: {
      id: MERCHANT_ID,
      business_name: 'Test Store',
      slug: 'test-store',
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
    },
    error: null,
  };
  featureSettingsResult = { data: null, error: null };
  orderPaymentResult = { data: { wallet_amount_used: 0 }, error: null };
  savingsRedemptionsResult = { data: [], error: null };
  routeMocks.authenticateApiRequest.mockResolvedValue({ user: null });
  routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
    available: false,
    reason: 'provider_evidence_unavailable',
  });
  rpcCalls.length = 0;
}

function enableKorapayForTest() {
  featureSettingsResult = {
    data: {
      korapay_enabled: true,
    },
    error: null,
  };
}

function enableDvaForTest() {
  featureSettingsResult = {
    data: {
      wallet_paystack_dva_enabled: true,
    },
    error: null,
  };
}

// ---- Tests ----

describe('POST /api/payments/initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JUICYWAY_SECRET_KEY', 'test-juicyway-key');
    mockCreateDedicatedVirtualAccount.mockResolvedValue({
      account_name: 'Test Store / John Doe',
      account_number: '1234567890',
      bank_name: 'Wema Bank',
    });
    setupDefaults();
  });

  describe('validation', () => {
    it('returns 400 for invalid merchant_id', async () => {
      const res = await POST(makeRequest({ ...validBody, merchant_id: 'bad' }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for missing customer_email', async () => {
      const { customer_email: _, ...body } = validBody;
      const res = await POST(makeRequest(body));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a requested REDVAULT checkout before any provider or order lookup while provider evidence is unavailable', async () => {
      const res = await POST(
        makeRequest({ ...validBody, payment_method: 'uba_redvault' })
      );
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('REDVAULT_UNAVAILABLE');
      expect(mockInitializePaystack).not.toHaveBeenCalled();
      expect(rpcCalls).toEqual([]);
    });

    it('rejects an alternate gateway instead of silently switching a REDVAULT request to Paystack', async () => {
      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'korapay',
          payment_method: 'uba_redvault',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('REDVAULT_GATEWAY_UNSUPPORTED');
      expect(mockInitializeKorapay).not.toHaveBeenCalled();
      expect(mockInitializePaystack).not.toHaveBeenCalled();
    });

    it('rejects DVA payment type for a REDVAULT request', async () => {
      const res = await POST(
        makeRequest({
          ...validBody,
          payment_method: 'uba_redvault',
          payment_type: 'dva',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('REDVAULT_PAYMENT_TYPE_UNSUPPORTED');
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('requires the persisted REDVAULT payment method instead of allowing a generic gateway fallback', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            payment_method: 'uba_redvault',
            total: 5000,
          },
        ],
        error: null,
      };

      const res = await POST(makeRequest(validBody));
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('REDVAULT_PAYMENT_METHOD_REQUIRED');
      expect(mockInitializePaystack).not.toHaveBeenCalled();
    });

    it('does not let a REDVAULT request initialize a non-REDVAULT order', async () => {
      routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
        available: true,
      });

      const res = await POST(
        makeRequest({ ...validBody, payment_method: 'uba_redvault' })
      );
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('REDVAULT_ORDER_REQUIRED');
      expect(mockInitializePaystack).not.toHaveBeenCalled();
    });

    it('initializes from the reserved server attempt and reuses its persisted hosted URL', async () => {
      routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
        available: true,
      });
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            payment_method: 'uba_redvault',
            total: 5000,
          },
        ],
        error: null,
      };
      redvaultAttemptReserveResults = [
        {
          data: [
            {
              amount_kobo: 500000,
              attempt_id: 'attempt-1',
              authorization_url: null,
              bank_code: '033',
              reference: 'RV-attempt-1',
              state: 'created',
            },
          ],
          error: null,
        },
        {
          data: [
            {
              amount_kobo: 500000,
              attempt_id: 'attempt-1',
              authorization_url: 'https://paystack.test/checkout/1',
              bank_code: '033',
              reference: 'RV-attempt-1',
              state: 'initialized',
            },
          ],
          error: null,
        },
      ];
      redvaultAttemptClaimResults = [
        {
          data: [
            {
              amount_kobo: 500000,
              attempt_id: 'attempt-1',
              authorization_url: null,
              bank_code: '033',
              initialization_claimed: true,
              reference: 'RV-attempt-1',
              state: 'initializing',
            },
          ],
          error: null,
        },
      ];
      redvaultAttemptInitializeResult = {
        data: [
          {
            amount_kobo: 500000,
            attempt_id: 'attempt-1',
            authorization_url: 'https://paystack.test/checkout/1',
            bank_code: '033',
            reference: 'RV-attempt-1',
            state: 'initialized',
          },
        ],
        error: null,
      };
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.test/checkout/1',
      });
      const request = makeRequest({
        ...validBody,
        amount: 1,
        payment_method: 'uba_redvault',
      });

      const first = await POST(request);
      const second = await POST(
        makeRequest({ ...validBody, payment_method: 'uba_redvault' })
      );

      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        checkout_url: 'https://paystack.test/checkout/1',
        payment_method: 'uba_redvault',
        reference: 'RV-attempt-1',
      });
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({
        checkout_url: 'https://paystack.test/checkout/1',
        reference: 'RV-attempt-1',
      });
      expect(mockInitializePaystack).toHaveBeenCalledTimes(1);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500000,
          channels: ['card'],
          metadata: expect.objectContaining({
            custom_filters: {
              banks: ['033'],
              card_brands: ['verve', 'visa', 'mastercard'],
            },
            merchant_id: MERCHANT_ID,
            order_id: ORDER_ID,
          }),
          reference: 'RV-attempt-1',
        })
      );
      expect(
        rpcCalls.filter(({ name }) => name === 'create_payment_transaction')
      ).toHaveLength(0);
    });

    it('ignores a client-supplied amount and derives the gateway amount from the order', async () => {
      enableKorapayForTest();
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/derived',
        checkout_url: 'https://korapay.com/checkout/derived',
      });

      const res = await POST(
        makeRequest({ ...validBody, amount: -100, gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializeKorapay).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5000 })
      );
    });
  });

  describe('order validation', () => {
    it('returns 404 when order snapshot not found', async () => {
      rpcResult = { data: [], error: null };
      const res = await POST(makeRequest(validBody));
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.code).toBe('ORDER_NOT_FOUND');
    });

    it('returns 404 when RPC returns an error', async () => {
      rpcResult = { data: null, error: { message: 'Not found' } };
      const res = await POST(makeRequest(validBody));
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.code).toBe('ORDER_NOT_FOUND');
    });

    it('returns 403 on merchant mismatch', async () => {
      rpcResult = {
        data: [
          { merchant_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', total: 5000 },
        ],
        error: null,
      };
      const res = await POST(makeRequest(validBody));
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.code).toBe('MERCHANT_MISMATCH');
    });

    it('rejects starting a payment for a cancelled order', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 5000,
            shipping_status: 'cancelled',
          },
        ],
        error: null,
      };
      const res = await POST(makeRequest(validBody));
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.code).toBe('ORDER_NOT_PAYABLE');
    });

    it('does not let a client amount above the order total change the charge', async () => {
      rpcResult = {
        data: [{ merchant_id: MERCHANT_ID, total: 1000 }],
        error: null,
      };
      enableKorapayForTest();
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/derived',
        checkout_url: 'https://korapay.com/checkout/derived',
      });

      const res = await POST(
        makeRequest({ ...validBody, amount: 5000, gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializeKorapay).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1000 })
      );
    });

    it('derives residual gateway amount after wallet and savings credits', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 5000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      orderPaymentResult = { data: { wallet_amount_used: 1200 }, error: null };
      savingsRedemptionsResult = { data: [{ amount: 800 }], error: null };
      enableKorapayForTest();
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/abc',
        checkout_url: 'https://korapay.com/checkout/abc',
      });

      const res = await POST(
        makeRequest({ ...validBody, amount: 1, gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializeKorapay).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 3000 })
      );
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({
        p_amount: 3000,
        p_gateway: 'korapay',
      });
    });
  });

  describe('merchant lookup', () => {
    it('returns 404 when merchant not found', async () => {
      merchantResult = { data: null, error: { message: 'Not found' } };
      const res = await POST(makeRequest(validBody));
      const json = await res.json();
      expect(res.status).toBe(404);
      expect(json.code).toBe('MERCHANT_NOT_FOUND');
    });
  });

  describe('korapay gateway', () => {
    it('returns GATEWAY_DISABLED when Korapay is explicitly disabled', async () => {
      featureSettingsResult = {
        data: {
          korapay_enabled: false,
        },
        error: null,
      };

      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(mockInitializeKorapay).not.toHaveBeenCalled();
    });

    it('disables Korapay by default when the feature row is missing (opt-in)', async () => {
      // Korapay is opt-in (default OFF). A merchant with no feature-settings row
      // falls back to shared defaults, which now default korapay_enabled=false, so
      // a Korapay charge is rejected rather than routed through Baci's own account.
      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(mockInitializeKorapay).not.toHaveBeenCalled();
    });

    it('returns success with checkout_url for korapay', async () => {
      enableKorapayForTest();
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/abc',
        checkout_url: 'https://korapay.com/checkout/abc',
      });
      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('korapay');
      expect(json.checkout_url).toBe('https://korapay.com/checkout/abc');
    });

    it('falls back to checkout_url when korapay omits authorization_url', async () => {
      enableKorapayForTest();
      mockInitializeKorapay.mockResolvedValue({
        checkout_url: 'https://korapay.com/checkout/abc',
      });

      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.authorization_url).toBe('https://korapay.com/checkout/abc');
      expect(json.checkout_url).toBe('https://korapay.com/checkout/abc');
    });

    it('falls back to authorization_url when korapay omits checkout_url', async () => {
      enableKorapayForTest();
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/xyz',
      });

      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.authorization_url).toBe('https://korapay.com/checkout/xyz');
      expect(json.checkout_url).toBe('https://korapay.com/checkout/xyz');
    });

    it('returns 502 when korapay initialization throws', async () => {
      enableKorapayForTest();
      mockInitializeKorapay.mockRejectedValue(new Error('Korapay down'));
      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();
      expect(res.status).toBe(502);
      expect(json.code).toBe('GATEWAY_INIT_ERROR');
    });
  });

  describe('paystack gateway', () => {
    it('returns success with authorization_url for paystack', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/abc',
      });
      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack' })
      );
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('paystack');
      expect(json.authorization_url).toBe('https://paystack.com/pay/abc');
    });

    it('redacts payment payload logs without mutating the Paystack request payload', async () => {
      const logSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/redacted',
      });

      try {
        const res = await POST(
          makeRequest({ ...validBody, gateway: 'paystack' })
        );
        const json = await res.json();
        const loggedOutput = logSpy.mock.calls
          .map((call) => call.map((value) => String(value)).join(' '))
          .join('\n');

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(loggedOutput).toContain('[PaymentInit] Raw Request Body:');
        expect(loggedOutput).toContain('[PaymentInit] Paystack Phone Debug:');
        expect(loggedOutput).toContain('"customer_email":"[REDACTED]"');
        expect(loggedOutput).toContain('"customer_phone":"[REDACTED]"');
        expect(loggedOutput).toContain('"billing_address":"[REDACTED]"');
        expect(loggedOutput).toContain('"original_phone":"[REDACTED]"');
        expect(loggedOutput).toContain('"formatted_phone":"[REDACTED]"');
        expect(loggedOutput).not.toContain('customer@example.com');
        expect(loggedOutput).not.toContain('John Doe');
        expect(loggedOutput).not.toContain('08012345678');
        expect(loggedOutput).not.toContain('+2348012345678');
        expect(loggedOutput).not.toContain('123 Main St');
        expect(mockInitializePaystack).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'customer@example.com',
            phone: '+2348012345678',
            metadata: expect.objectContaining({
              customer_name: 'John Doe',
              customer_phone: '+2348012345678',
              phone: '+2348012345678',
              phone_number: '+2348012345678',
            }),
          })
        );
      } finally {
        logSpy.mockRestore();
      }
    });

    it('restricts Paystack hosted checkout to cards for non-Nigerian checkout details', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/international-card',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          customer_phone: '+919876543210',
          billing_address: {
            ...validBody.billing_address,
            city: 'Bengaluru',
            country: 'IN',
          },
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card'],
          phone: '+919876543210',
        })
      );
    });

    it('uses card-only Paystack checkout when billing country is India even with a Nigerian phone', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/india-card-only',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          customer_phone: '08012345678',
          billing_address: {
            ...validBody.billing_address,
            city: 'Bengaluru',
            country: 'IN',
          },
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card'],
          phone: '+2348012345678',
        })
      );
    });

    it('uses card-only Paystack checkout when billing country is missing even with a Nigerian phone', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/missing-country-card-only',
      });
      const { billing_address: _, ...bodyWithoutBillingAddress } = validBody;

      const res = await POST(
        makeRequest({
          ...bodyWithoutBillingAddress,
          customer_phone: '08012345678',
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card'],
          phone: '+2348012345678',
        })
      );
    });

    it('filters unsupported and DVA-disabled Paystack channels for Nigerian checkout details', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/filtered-channels',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          channels: ['card', 'mobile_money', 'bank_transfer'],
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card'],
        })
      );
    });

    it('filters hosted Paystack bank transfer even when DVA is enabled', async () => {
      // Hosted pay-with-transfer bills 1.5% + ₦100 capped ₦2,000; bank
      // transfers are only offered via the DVA branch (1% capped ₦300).
      enableDvaForTest();
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/filtered-channels',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          channels: ['card', 'mobile_money', 'bank_transfer'],
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card'],
        })
      );
    });

    it('uses Nigerian Paystack channel defaults when supplied channels are empty', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/default-channels',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          channels: [],
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card', 'bank', 'ussd'],
        })
      );
    });

    it('keeps bank transfer out of Nigerian Paystack defaults even when DVA is enabled', async () => {
      enableDvaForTest();
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/default-channels',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          channels: [],
          gateway: 'paystack',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: ['card', 'bank', 'ussd'],
        })
      );
    });

    it('returns GATEWAY_DISABLED when Paystack is explicitly disabled', async () => {
      featureSettingsResult = {
        data: {
          paystack_enabled: false,
          wallet_paystack_dva_enabled: true,
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(mockInitializePaystack).not.toHaveBeenCalled();
    });

    it('returns GATEWAY_DISABLED when omitted-gateway DVA requires disabled Paystack', async () => {
      featureSettingsResult = {
        data: {
          paystack_enabled: false,
          korapay_enabled: true,
          wallet_paystack_dva_enabled: true,
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, payment_type: 'dva' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(mockInitializePaystack).not.toHaveBeenCalled();
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('returns 400 when paystack subaccount not configured', async () => {
      merchantResult = {
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Store',
          slug: 'test-store',
          paystack_subaccount_code: null,
        },
        error: null,
      };
      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack' })
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_NOT_CONFIGURED');
    });

    it('creates dedicated virtual accounts with the merchant subaccount', async () => {
      enableDvaForTest();

      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack', payment_type: 'dva' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.dva).toEqual({
        account_name: 'Test Store / John Doe',
        account_number: '1234567890',
        bank_name: 'Wema Bank',
      });
      expect(mockCreateDedicatedVirtualAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'customer@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '08012345678',
        }),
        { subaccount: 'ACCT_TESTMOCK1234567' }
      );
    });

    it('rejects dedicated virtual accounts when bank transfer is disabled', async () => {
      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack', payment_type: 'dva' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('rejects dedicated virtual accounts when Paystack is disabled', async () => {
      featureSettingsResult = {
        data: {
          paystack_enabled: false,
          wallet_paystack_dva_enabled: true,
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack', payment_type: 'dva' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('rejects dedicated virtual accounts for non-Nigerian checkout details', async () => {
      enableDvaForTest();

      const res = await POST(
        makeRequest({
          ...validBody,
          customer_phone: '+919876543210',
          billing_address: {
            ...validBody.billing_address,
            city: 'Bengaluru',
            country: 'IN',
          },
          gateway: 'paystack',
          payment_type: 'dva',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('PAYMENT_METHOD_COUNTRY_UNSUPPORTED');
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('rejects dedicated virtual accounts when billing country is missing', async () => {
      enableDvaForTest();
      const { billing_address: _, ...bodyWithoutBillingAddress } = validBody;

      const res = await POST(
        makeRequest({
          ...bodyWithoutBillingAddress,
          customer_phone: '08012345678',
          gateway: 'paystack',
          payment_type: 'dva',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('PAYMENT_METHOD_COUNTRY_UNSUPPORTED');
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });
  });

  describe('bnpl gateways', () => {
    it.each([
      'credit_direct',
      'credpal',
    ] as const)('uses the request origin for %s BNPL launcher URLs', async (gateway) => {
      const res = await POST(makeRequest({ ...validBody, gateway }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe(gateway);
      expect(json.authorization_url).toMatch(
        /^http:\/\/localhost:3000\/test-store\/checkout\/bnpl\?/
      );
      expect(json.checkout_url).toBe(json.authorization_url);
      expect(json.authorization_url).toContain(
        'orderId=a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      );
      expect(json.authorization_url).toContain('trackingToken=track-token-123');
    });

    it('returns GATEWAY_DISABLED when Klump is not enabled for the merchant', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 50_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: false,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 50_000, gateway: 'klump' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_DISABLED');
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('rejects Klump when store credits already reduced the payable total', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 50_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      orderPaymentResult = {
        data: { wallet_amount_used: 25_000 },
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 25_000, gateway: 'klump' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('AMOUNT_COMPOSITION_UNSUPPORTED');
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('rejects Klump outside the merchant configured amount range', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 5_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 5_000, gateway: 'klump' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('AMOUNT_OUT_OF_RANGE');
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('allows Klump orders up to the default merchant amount range', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 1_000_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 1_000_000, gateway: 'klump' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('klump');
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(true);
    });

    it('returns a Klump BNPL launcher URL with reference and tracking token', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 50_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 50_000, gateway: 'klump' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('klump');
      expect(json.reference).toBe('BAC-ABCD12345678');
      expect(json.authorization_url).toMatch(
        /^http:\/\/localhost:3000\/test-store\/checkout\/bnpl\?/
      );
      expect(json.checkout_url).toBe(json.authorization_url);
      expect(json.authorization_url).toContain('gateway=klump');
      expect(json.authorization_url).toContain(
        'orderId=a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      );
      expect(json.authorization_url).toContain('reference=BAC-ABCD12345678');
      expect(json.authorization_url).toContain('trackingToken=track-token-123');

      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({
        p_amount: 50_000,
        p_gateway: 'klump',
        p_merchant_amount: 50_000,
        p_platform_fee: 0,
        p_reference: 'BAC-ABCD12345678',
      });
    });

    it('keeps the order total as the RPC amount and stores the rounded Klump charge amount', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 58_088.5,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 58_088.5, gateway: 'klump' })
      );

      expect(res.status).toBe(200);
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({
        p_amount: 58_088.5,
        p_gateway: 'klump',
        p_merchant_amount: 58_089,
        p_platform_fee: 0,
        p_reference: 'BAC-ABCD12345678',
      });
    });

    it('rounds the stored order total for Klump when the request amount is within tolerance', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 58_088.5,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 58_088.491, gateway: 'klump' })
      );

      expect(res.status).toBe(200);
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({
        p_amount: 58_088.5,
        p_gateway: 'klump',
        p_merchant_amount: 58_089,
        p_platform_fee: 0,
        p_reference: 'BAC-ABCD12345678',
      });
    });

    it('allows a Klump request amount slightly above the stored total within tolerance', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 58_088.5,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest({ ...validBody, amount: 58_088.509, gateway: 'klump' })
      );

      expect(res.status).toBe(200);
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({
        p_amount: 58_088.5,
        p_gateway: 'klump',
        p_merchant_amount: 58_089,
        p_platform_fee: 0,
        p_reference: 'BAC-ABCD12345678',
      });
    });

    it('keeps Klump launcher URLs slugless on custom domain checkouts', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 50_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest(
          { ...validBody, amount: 50_000, gateway: 'klump' },
          {
            headers: { referer: 'https://shop.example.com/checkout' },
            url: 'https://shop.example.com/api/payments/initialize',
          }
        )
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.authorization_url).toMatch(
        /^https:\/\/shop.example.com\/checkout\/bnpl\?/
      );
      expect(json.authorization_url).not.toContain('/test-store/checkout/bnpl');
    });

    it('uses the public host header instead of the internal request URL for BNPL launcher URLs', async () => {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 50_000,
            tracking_token: 'track-token-123',
          },
        ],
        error: null,
      };
      featureSettingsResult = {
        data: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 500_000,
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'korapay',
          preferred_local_gateway: 'paystack',
        },
        error: null,
      };

      const res = await POST(
        makeRequest(
          { ...validBody, amount: 50_000, gateway: 'klump' },
          {
            headers: {
              host: 'shop.example.com',
              referer: 'https://shop.example.com/checkout',
              'x-forwarded-proto': 'https',
            },
            url: 'https://internal.vercel.app/api/payments/initialize',
          }
        )
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.authorization_url).toMatch(
        /^https:\/\/shop.example.com\/checkout\/bnpl\?/
      );
      expect(json.authorization_url).not.toContain('internal.vercel.app');
      expect(json.authorization_url).not.toContain('/test-store/checkout/bnpl');
    });
  });

  describe('juicyway crypto gateway', () => {
    it('returns crypto_payment with address when immediately available', async () => {
      mockInitializeJuicyway.mockResolvedValue({
        id: 'session-123',
        status: 'pending',
      });
      mockCapturePaymentWithCrypto.mockResolvedValue({
        success: true,
        data: {
          payment: {
            id: 'payment-456',
            currency: 'USD',
            amount: 500000,
            status: 'processing',
            payment_method: {
              address: 'TRX_WALLET_ADDR_123',
              chain: 'TRX',
              qrcode: 'https://qr.example.com/qr.png',
            },
          },
        },
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'juicyway',
          crypto_chain: 'TRX',
          crypto_currency: 'USDT',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('juicyway');
      expect(json.crypto_payment.address).toBe('TRX_WALLET_ADDR_123');
      expect(json.crypto_payment.chain).toBe('TRX');
      expect(json.crypto_payment.currency).toBe('USDT');
      expect(json.crypto_payment.payment_id).toBe('payment-456');
      expect(json.crypto_address_pending).toBeUndefined();
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall).toEqual({
        name: 'create_payment_transaction',
        args: expect.objectContaining({
          p_session_id: 'session-123',
          p_metadata: expect.objectContaining({
            juicyway_expected_amount: 500000,
            juicyway_expected_currency: 'USD',
            juicyway_fx_rate: expect.any(Number),
          }),
        }),
      });
    });

    it('returns crypto_address_pending when address not ready after polling', {
      timeout: 30000,
    }, async () => {
      mockInitializeJuicyway.mockResolvedValue({
        id: 'session-123',
        status: 'pending',
      });
      mockCapturePaymentWithCrypto.mockResolvedValue({
        success: true,
        data: {
          payment: {
            id: 'payment-456',
            currency: 'USDT',
            amount: 500000,
            status: 'pending',
            // No payment_method with address
          },
        },
      });
      // All polls return pending without address
      mockGetPaymentSession.mockResolvedValue({
        success: true,
        data: {
          status: 'pending',
          payment: { id: 'payment-456', status: 'pending' },
        },
      });
      mockGetPayment.mockResolvedValue({
        success: true,
        data: {
          status: 'pending',
          payment_method: { type: 'crypto_address' },
        },
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'juicyway',
          crypto_chain: 'TRX',
          crypto_currency: 'USDT',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.crypto_address_pending).toBe(true);
      expect(json.crypto_payment.address).toBe('');
      expect(json.session_id).toBe('session-123');
      expect(json.crypto_payment.payment_id).toBe('payment-456');
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall).toEqual({
        name: 'create_payment_transaction',
        args: expect.objectContaining({
          p_session_id: 'session-123',
          p_metadata: expect.objectContaining({
            juicyway_expected_amount: 500000,
            juicyway_expected_currency: 'USDT',
            juicyway_fx_rate: expect.any(Number),
          }),
        }),
      });
    });

    it('fails checkout when the initial transaction insert rejects Juicyway validation metadata', async () => {
      mockInitializeJuicyway.mockResolvedValue({
        id: 'session-123',
        status: 'pending',
      });
      mockCapturePaymentWithCrypto.mockResolvedValue({
        success: true,
        data: {
          payment: {
            id: 'payment-456',
            amount: 500000,
            status: 'processing',
            payment_method: {
              address: 'TRX_WALLET_ADDR_123',
              chain: 'TRX',
              currency: 'USDT',
            },
          },
        },
      });
      rpcTransactionResult = {
        data: null,
        error: { message: 'transaction insert failed' },
      };

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'juicyway',
          crypto_chain: 'TRX',
          crypto_currency: 'USDT',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json).toMatchObject({
        code: 'TRANSACTION_CREATE_FAILED',
        error: 'Failed to create transaction',
      });
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({
        p_metadata: expect.objectContaining({
          juicyway_expected_amount: 500000,
          juicyway_expected_currency: 'USDT',
        }),
      });
    });

    it('returns address found during polling', { timeout: 15000 }, async () => {
      mockInitializeJuicyway.mockResolvedValue({
        id: 'session-123',
        status: 'pending',
      });
      mockCapturePaymentWithCrypto.mockResolvedValue({
        success: true,
        data: {
          payment: { id: 'payment-456', amount: 500000, status: 'pending' },
        },
      });
      // First poll: no address; second poll: address available
      mockGetPaymentSession
        .mockResolvedValueOnce({
          success: true,
          data: {
            payment: { id: 'payment-456', status: 'pending' },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            payment: {
              id: 'payment-456',
              status: 'processing',
              amount: 500000,
              payment_method: {
                address: 'TRX_ADDR_POLLED',
                chain: 'TRX',
                currency: 'USDT',
              },
            },
          },
        });
      mockGetPayment.mockResolvedValue({
        success: true,
        data: { status: 'pending', payment_method: { type: 'crypto_address' } },
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'juicyway',
          crypto_chain: 'TRX',
          crypto_currency: 'USDT',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.crypto_payment.address).toBe('TRX_ADDR_POLLED');
      expect(json.crypto_address_pending).toBeUndefined();
    });

    it('returns 502 when capture fails', async () => {
      mockInitializeJuicyway.mockResolvedValue({
        id: 'session-123',
        status: 'pending',
      });
      mockCapturePaymentWithCrypto.mockResolvedValue({
        success: false,
        error: 'Capture failed',
      });

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'juicyway',
          crypto_chain: 'TRX',
          crypto_currency: 'USDT',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.code).toBe('GATEWAY_INIT_ERROR');
      expect(json.error).toContain('Capture failed');
    });

    it('returns 400 when JUICYWAY_SECRET_KEY not set', async () => {
      vi.stubEnv('JUICYWAY_SECRET_KEY', '');
      const res = await POST(
        makeRequest({ ...validBody, gateway: 'juicyway' })
      );
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.code).toBe('GATEWAY_NOT_CONFIGURED');
    });
  });

  describe('transaction record', () => {
    it('returns 500 when transaction RPC fails', async () => {
      rpcTransactionResult = {
        data: null,
        error: { message: 'RPC error' },
      };
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/abc',
        checkout_url: 'https://korapay.com/checkout/abc',
      });
      enableKorapayForTest();

      const res = await POST(makeRequest({ ...validBody, gateway: 'korapay' }));
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.code).toBe('TRANSACTION_CREATE_FAILED');
    });
  });

  describe('multi-country currency handling', () => {
    function snapshotWithCurrency(
      currency: string,
      extra: Record<string, unknown> = {}
    ) {
      rpcResult = {
        data: [
          {
            merchant_id: MERCHANT_ID,
            total: 5000,
            currency,
            tracking_token: 'track-token-123',
            ...extra,
          },
        ],
        error: null,
      };
    }

    it('(a) charges the order currency for the unchanged NGN happy path', async () => {
      enableKorapayForTest();
      snapshotWithCurrency('NGN');
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/ngn',
        checkout_url: 'https://korapay.com/checkout/ngn',
      });

      const res = await POST(
        makeRequest({ ...validBody, currency: 'NGN', gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockInitializeKorapay).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'NGN', amount: 5000 })
      );
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({ p_currency: 'NGN' });
    });

    it('(b) returns 400 CURRENCY_MISMATCH when the client sends a currency that differs from the order', async () => {
      enableKorapayForTest();
      snapshotWithCurrency('NGN');

      const res = await POST(
        makeRequest({ ...validBody, currency: 'USD', gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('CURRENCY_MISMATCH');
      expect(mockInitializeKorapay).not.toHaveBeenCalled();
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('(c) charges GHS (no coercion) for a GHS order routed to korapay', async () => {
      enableKorapayForTest();
      snapshotWithCurrency('GHS');
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/ghs',
        checkout_url: 'https://korapay.com/checkout/ghs',
      });

      const res = await POST(
        makeRequest({ ...validBody, currency: 'GHS', gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('korapay');
      expect(mockInitializeKorapay).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'GHS', amount: 5000 })
      );
      // The fee helper MUST receive the resolved currency ('GHS'), not just the
      // amount — this is the guard that keeps the foreign-currency fee correct.
      expect(mockKorapayCalculatePlatformFee).toHaveBeenCalledWith(5000, 'GHS');
      const transactionCall = rpcCalls.find(
        (call) => call.name === 'create_payment_transaction'
      );
      expect(transactionCall?.args).toMatchObject({ p_currency: 'GHS' });
    });

    it('(d) returns 400 UNSUPPORTED_CURRENCY for a gateway-ineligible currency instead of charging NGN', async () => {
      enableKorapayForTest();
      snapshotWithCurrency('INR');

      const res = await POST(
        makeRequest({ ...validBody, currency: 'INR', gateway: 'korapay' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('UNSUPPORTED_CURRENCY');
      expect(mockInitializeKorapay).not.toHaveBeenCalled();
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('(e) returns 400 UNSUPPORTED_CURRENCY for a GHS order routed to paystack (NGN-only)', async () => {
      snapshotWithCurrency('GHS');

      const res = await POST(
        makeRequest({ ...validBody, currency: 'GHS', gateway: 'paystack' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('UNSUPPORTED_CURRENCY');
      expect(mockInitializePaystack).not.toHaveBeenCalled();
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('(f) returns 400 UNSUPPORTED_CURRENCY for a non-NGN order routed to juicyway', async () => {
      snapshotWithCurrency('GHS');

      const res = await POST(
        makeRequest({ ...validBody, currency: 'GHS', gateway: 'juicyway' })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('UNSUPPORTED_CURRENCY');
      expect(mockInitializeJuicyway).not.toHaveBeenCalled();
      expect(
        rpcCalls.some((call) => call.name === 'create_payment_transaction')
      ).toBe(false);
    });

    it('(g) never auto-selects paystack for a non-NGN order even when preferred_international_gateway is paystack', async () => {
      // Paystack settles NGN only, so international auto-selection must
      // always route to korapay regardless of the merchant's preference.
      featureSettingsResult = {
        data: {
          korapay_enabled: true,
          paystack_enabled: true,
          preferred_international_gateway: 'paystack',
        },
        error: null,
      };
      snapshotWithCurrency('GHS');
      mockInitializeKorapay.mockResolvedValue({
        authorization_url: 'https://korapay.com/checkout/ghs-auto',
        checkout_url: 'https://korapay.com/checkout/ghs-auto',
      });

      const res = await POST(makeRequest({ ...validBody, currency: 'GHS' }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.gateway).toBe('korapay');
      expect(mockInitializeKorapay).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'GHS' })
      );
      expect(mockInitializePaystack).not.toHaveBeenCalled();
    });
  });
});
