import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
} from '@/lib/checkout/order-idempotency';
import { generateOrderConfirmationEmail } from '@/lib/email-templates';
import { logger } from '@/lib/logger';
import { createQuizVoucherToken } from '@/lib/quiz-voucher-token';
import { POST } from './route';

// Hoisted mocks for fire-and-forget side effects so tests don't await emails / push.
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
  mockGeneratePaymentAccount: vi.fn(() =>
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

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mockRevalidateProducts,
  revalidateProductSlugs: mockRevalidateProductSlugs,
}));

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: mockGeneratePaymentAccount,
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: mockGenerateReceiptBlob,
  resolveReceiptLogoDataUri: mockResolveReceiptLogoDataUri,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

// The route's stamped-currency read-back uses the service-role client (guest
// checkouts cannot read orders under RLS), so every suite primes the admin
// mock with a default NGN row; currency-aware fixtures override it.
function primeAdminOrderCurrencyRead(currency: string | null = 'NGN') {
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: currency ? { currency } : null,
        error: null,
      }),
    })),
  } as never);
}

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

const mockRecordPreGatewayRedemption = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
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

vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: { getLocations: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';
const AUTH_USER_ID = '123e4567-e89b-12d3-a456-426614174099';

function mockAuthUser(id: string) {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

interface RpcOverrides {
  create_storefront_redvault_order_draft?: { data: unknown; error: unknown };
  // Per-RPC return values. Default values mirror a minimal happy path.
  create_storefront_order?: { data: unknown; error: unknown };
  create_storefront_order_with_quiz_voucher?: {
    data: unknown;
    error: unknown;
  };
  create_storefront_order_with_savings?: { data: unknown; error: unknown };
  create_storefront_order_with_discount_code?: {
    data: unknown;
    error: unknown;
  };
  has_storefront_order_idempotency_key?: { data: unknown; error: unknown };
  get_storefront_discount_code?: { data: unknown; error: unknown };
  redeem_wallet_for_order?: { data: unknown; error: unknown };
  redeem_savings_for_order?: { data: unknown; error: unknown };
  finalize_wallet_order_payment?: { data: unknown; error: unknown };
  finalize_store_credit_order_payment?: { data: unknown; error: unknown };
  finalize_quiz_voucher_order_payment?: { data: unknown; error: unknown };
  get_checkout_shipping_quote?: { data: unknown; error: unknown };
  persist_storefront_order_delivery_metadata?: {
    data: unknown;
    error: unknown;
  };
}

function buildMockSupabase(
  overrides: RpcOverrides = {},
  opts: {
    productRows?: Array<{
      commodity_code?: string | null;
      dimensions?: unknown;
      id: string;
      name?: string | null;
      price: number;
      slug?: string | null;
      vat_category_code?: string | null;
      vat_rate?: number | null;
      weight_unit?: string | null;
      weight_value?: number | string | null;
    }>;
    merchantVatRegistrationStatus?: string | null;
    // Per-award-id status overrides for the quiz_awards status pre-check. Absent
    // ids default to an approved store-credit award; `missing: true` omits the
    // row entirely (award not found).
    quizAwardOverrides?: Record<
      string,
      {
        award_type?: string;
        customer_id?: string;
        missing?: boolean;
        reserved_order_id?: string;
        status?: string;
      }
    >;
    // Simulate a transient failure of the quiz_awards status lookup itself.
    quizAwardLookupError?: boolean;
    // The order row returned by the claimed-award reserved-order idempotency
    // lookup (`orders` where id = reserved_order_id / order_items.order_id).
    claimedReservedOrder?: Record<string, unknown> | null;
    // Simulate a transient failure of the claimed-order (`orders`) lookup.
    claimedReservedOrderError?: boolean;
    // The order_id returned by the standard-path fallback lookup
    // (`order_items` where quiz_award_id = award id).
    claimedOrderItemOrderId?: string | null;
    // Simulate a transient failure of the standard-path `order_items` lookup.
    claimedOrderItemError?: boolean;
    shippingQuote?: unknown;
  } = {}
) {
  const sharedChainable: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // B3.5 round 7: helper's `merchants.select(...).eq(...).maybeSingle()`
    // call. Default returns the existing merchant fixture; the
    // helper reads `vat_registration_status` which is absent →
    // helper treats merchant as non-registered → returns 0. Existing
    // assertions in this file see no behavior change.
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: MERCHANT_ID,
        business_name: 'Test Merchant',
        country: 'NG',
        slug: 'test-merchant',
        support_email: 'support@example.com',
        email_sender_name: 'Test Store',
        email: 'merchant@example.com',
        vat_registration_status: opts.merchantVatRegistrationStatus ?? null,
      },
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: {
        id: MERCHANT_ID,
        business_name: 'Test Merchant',
        country: 'NG',
        slug: 'test-merchant',
        support_email: 'support@example.com',
        email_sender_name: 'Test Store',
        email: 'merchant@example.com',
        vat_registration_status: opts.merchantVatRegistrationStatus ?? null,
      },
      error: null,
    }),
    // B3.5 round 7: helper's
    // `products.select(...).eq('merchant_id', ...).in('id', ...).returns()`
    // chain. Default returns [] so helper iterates no items and
    // returns 0.
    in: vi.fn().mockReturnThis(),
    returns: vi
      .fn()
      .mockResolvedValue({ data: opts.productRows ?? [], error: null }),
    // The per-line negotiation loader reads the products catalog via the
    // modern `.overrideTypes()` idiom (postgrest deprecated `.returns()`).
    // Mirror `returns` so every order-create test resolves the products
    // select; an empty catalog → loader returns null (no-op, no rejection).
    overrideTypes: vi
      .fn()
      .mockResolvedValue({ data: opts.productRows ?? [], error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: thenable mock
    then: (resolve: any) => Promise.resolve().then(resolve),
  };
  const quizAwardOverrides = opts.quizAwardOverrides ?? {};
  // The route loads all distinct awards via `.in('id', ids)` and gates on
  // status === 'approved' && award_type === 'store_credit'. Return one row per
  // queried id (approved store-credit by default) unless a test overrides it.
  const quizAwardChainable: any = {
    ...sharedChainable,
    in: vi.fn((_column: string, ids: string[]) => {
      if (opts.quizAwardLookupError) {
        return Promise.resolve({
          data: null,
          error: { message: 'transient lookup failure' },
        });
      }
      const rows = ids
        .filter((id) => !quizAwardOverrides[id]?.missing)
        .map((id) => ({
          id,
          status: quizAwardOverrides[id]?.status ?? 'approved',
          award_type: quizAwardOverrides[id]?.award_type ?? 'store_credit',
          customer_id: quizAwardOverrides[id]?.customer_id ?? CUSTOMER_ID,
          reserved_order_id: quizAwardOverrides[id]?.reserved_order_id ?? null,
          quiz_events: {
            compliance_verified: true,
            regulatory_basis: 'free_skill_competition',
            regulatory_evidence_ref: 'COUNSEL-2026-08-05',
            regulatory_jurisdiction: 'NG-LA',
          },
        }));
      return Promise.resolve({ data: rows, error: null });
    }),
  };

  const defaultRpcOutcomes: Record<string, { data: unknown; error: unknown }> =
    {
      create_storefront_order: {
        data: [
          {
            id: 'order-id',
            order_number: 'ORD-123',
            total: 1000,
            subtotal: 1000,
            shipping_fee: 0,
            customer_id: CUSTOMER_ID,
          },
        ],
        error: null,
      },
      create_storefront_order_with_quiz_voucher: {
        data: [
          {
            id: 'order-id',
            order_number: 'ORD-123',
            total: 1000,
            subtotal: 1000,
            shipping_fee: 0,
            customer_id: CUSTOMER_ID,
          },
        ],
        error: null,
      },
      redeem_wallet_for_order: { data: null, error: null },
      redeem_savings_for_order: { data: null, error: null },
      create_storefront_order_with_savings: { data: null, error: null },
      finalize_wallet_order_payment: { data: null, error: null },
      finalize_store_credit_order_payment: { data: null, error: null },
      finalize_quiz_voucher_order_payment: { data: true, error: null },
      has_storefront_order_idempotency_key: { data: false, error: null },
      // B3.5 round 7 (CodeRabbit High): the helper's variant lookup
      // now routes through this SECURITY DEFINER RPC.
      get_order_variant_overrides: { data: [], error: null },
      get_checkout_shipping_quote: {
        data: opts.shippingQuote ? [opts.shippingQuote] : null,
        error: null,
      },
      persist_storefront_order_delivery_metadata: { data: false, error: null },
    };

  if (!overrides.create_storefront_order_with_savings) {
    const savingsOutcome =
      overrides.redeem_savings_for_order ??
      defaultRpcOutcomes.redeem_savings_for_order;
    if (savingsOutcome.error) {
      defaultRpcOutcomes.create_storefront_order_with_savings = {
        data: null,
        error: savingsOutcome.error,
      };
    } else {
      const savingsRow = Array.isArray(savingsOutcome.data)
        ? savingsOutcome.data[0]
        : savingsOutcome.data;
      const createOrderOutcome =
        overrides.create_storefront_order ??
        defaultRpcOutcomes.create_storefront_order;
      const orderRow = Array.isArray(createOrderOutcome.data)
        ? createOrderOutcome.data[0]
        : createOrderOutcome.data;
      defaultRpcOutcomes.create_storefront_order_with_savings =
        savingsRow?.success
          ? {
              data: [
                {
                  ...(orderRow as Record<string, unknown>),
                  savings_goal_id: savingsRow.goal_id,
                  savings_goal_status: savingsRow.goal_status,
                  savings_redeemed_amount: savingsRow.redeemed_amount,
                  savings_redemption_id: savingsRow.redemption_id,
                  savings_redemption_success: true,
                },
              ],
              error: null,
            }
          : {
              data: [{ ...(orderRow as Record<string, unknown>) }],
              error: null,
            };
    }
  }

  return {
    auth: { getUser: vi.fn() },
    from: vi.fn((table: string) => {
      if (table === 'quiz_awards') return quizAwardChainable;
      if (
        table === 'orders' &&
        (opts.claimedReservedOrder !== undefined ||
          opts.claimedReservedOrderError)
      ) {
        return {
          ...sharedChainable,
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.claimedReservedOrderError
              ? null
              : opts.claimedReservedOrder,
            error: opts.claimedReservedOrderError
              ? { message: 'orders lookup blip' }
              : null,
          }),
        };
      }
      if (
        table === 'order_items' &&
        (opts.claimedOrderItemOrderId !== undefined ||
          opts.claimedOrderItemError)
      ) {
        return {
          ...sharedChainable,
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              !opts.claimedOrderItemError && opts.claimedOrderItemOrderId
                ? { order_id: opts.claimedOrderItemOrderId }
                : null,
            error: opts.claimedOrderItemError
              ? { message: 'order_items lookup blip' }
              : null,
          }),
        };
      }
      if (table === 'shipping_quotes') {
        return {
          ...sharedChainable,
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.shippingQuote ?? null,
            error: null,
          }),
        };
      }
      return sharedChainable;
    }),
    rpc: vi.fn((name: string) => {
      const outcome = overrides[name as keyof RpcOverrides] ??
        defaultRpcOutcomes[name] ?? { data: null, error: null };
      return Promise.resolve(outcome);
    }),
  };
}

function createOrderWithSavingsRow({
  redeemedAmount,
  goalId = '123e4567-e89b-12d3-a456-426614174555',
  goalStatus = 'paused',
  redemptionId = '77777777-aaaa-bbbb-cccc-dddddddddddd',
  total = 1000,
}: {
  goalId?: string;
  goalStatus?: string;
  redeemedAmount: number;
  redemptionId?: string;
  total?: number;
}) {
  return {
    id: 'order-id',
    order_number: 'ORD-123',
    total,
    subtotal: total,
    shipping_fee: 0,
    customer_id: CUSTOMER_ID,
    savings_goal_id: goalId,
    savings_goal_status: goalStatus,
    savings_redeemed_amount: redeemedAmount,
    savings_redemption_id: redemptionId,
    savings_redemption_success: true,
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// B3.5 round 7: the route now passes its own scoped supabase
// client into the tax helper (CodeRabbit High — no service-role
// in the Next.js layer). The helper's variant lookup routes
// through `get_order_variant_overrides` (SECURITY DEFINER RPC),
// which is mocked in `buildMockSupabase`'s `defaultRpcOutcomes`.

const baseOrderPayload = {
  merchant_id: MERCHANT_ID,
  customer_email: 'customer@example.com',
  customer_name: 'Test Customer',
  customer_phone: '08012345678',
  items: [{ product_id: 'p-1', quantity: 1, price: 1000, name: 'Widget' }],
  subtotal: 1000,
  shipping_fee: 0,
  discount_amount: 0,
  tax_amount: 0,
  payment_method: 'paystack',
  payment_status: 'unpaid',
  shipping_status: 'pending',
  shipping_address: {
    address: '123 Test St',
    city: 'Lagos',
    state: 'Lagos',
  },
};

const baseOrderRow = {
  id: 'order-id',
  order_number: 'ORD-123',
  total: 1000,
  subtotal: 1000,
  shipping_fee: 0,
  customer_id: CUSTOMER_ID,
};

describe('POST /api/orders REDVAULT integration', () => {
  it('accepts a valid Idempotency-Key with availability enabled and forwards it to the protected checkout', async () => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    const availability = await import(
      '@/lib/checkout/redvault-payment-availability'
    );
    const quoting = await import('@/lib/checkout/compute-redvault-order-quote');
    const checkout = await import(
      '@/lib/checkout/create-redvault-checkout-response'
    );
    const { redvaultTestQuote } = await import(
      '@/lib/checkout/redvault-test-fixture'
    );
    const availabilitySpy = vi
      .spyOn(availability, 'getRedvaultPaymentAvailability')
      .mockReturnValue({
        available: true,
        reason: 'provider_evidence_unavailable',
      });
    const quoteSpy = vi
      .spyOn(quoting, 'computeRedvaultOrderQuote')
      .mockResolvedValue(redvaultTestQuote);
    const checkoutSpy = vi
      .spyOn(checkout, 'createRedvaultCheckoutResponse')
      .mockResolvedValue(
        Response.json(
          { order: { id: 'protected-order' } },
          { status: 201 }
        ) as never
      );
    const supabase = buildMockSupabase();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: supabase as never,
    });
    try {
      const response = await POST(
        new NextRequest('http://localhost/api/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'redvault-enabled-checkout' },
          body: JSON.stringify({
            ...baseOrderPayload,
            merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
            payment_method: 'uba_redvault',
          }),
        })
      );
      expect(await response.json()).toEqual({
        order: { id: 'protected-order' },
      });
      expect(response.status).toBe(201);
      expect(checkoutSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderRpcArgs: expect.objectContaining({
            p_checkout_idempotency_key: 'redvault-enabled-checkout',
            p_checkout_request_hash: expect.any(String),
          }),
        })
      );
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'create_storefront_order',
        expect.anything()
      );
    } finally {
      availabilitySpy.mockRestore();
      quoteSpy.mockRestore();
      checkoutSpy.mockRestore();
    }
  });

  it('rejects an unavailable offer without generic order/provider side effects', async () => {
    vi.clearAllMocks();
    const productRows = [
      {
        id: 'p-1',
        name: 'Galaxy S24',
        brand: 'Samsung',
        condition: 'new',
        price: 1000,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ];
    const supabase = buildMockSupabase(
      {
        create_storefront_redvault_order_draft: {
          data: null,
          error: { message: 'redvault_disabled' },
        },
      },
      { productRows }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: supabase as never,
    });
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
          payment_method: 'uba_redvault',
        }),
        headers: { 'Idempotency-Key': 'redvault-fixture' },
      })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('REDVAULT_UNAVAILABLE');
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_redvault_order_draft',
      expect.anything()
    );
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

async function readJson(response: Response) {
  return JSON.parse(await response.text());
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/orders — quiz voucher guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    mockEnforcePrizeProductionGuard.mockImplementation(
      (_event, complianceVerified) => {
        if (!complianceVerified) {
          throw new MockQuizProductionNotApprovedError();
        }
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('requires authentication for voucher-bearing orders before compliance or order RPC work', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            price: 0,
            voucher_token: 'quiz-voucher-token',
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(401);
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_AUTH_REQUIRED',
      error: 'Authentication required for quiz voucher orders',
    });
    expect(mockEnforcePrizeProductionGuard).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    'voucher_token',
    'voucherToken',
    'voucher_award_id',
    'voucherAwardId',
  ] as const)('requires authentication for quiz voucher orders with %s before creating an order', async (voucherField) => {
    vi.stubEnv('QUIZ_PHASE', '1a');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', '');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            price: 0,
            [voucherField]: ' quiz-voucher-token ',
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(401);
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_AUTH_REQUIRED',
      error: 'Authentication required for quiz voucher orders',
    });
    expect(mockEnforcePrizeProductionGuard).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps Phase 1a quiz voucher orders locked even when approval env is truthy', async () => {
    vi.stubEnv('QUIZ_PHASE', '1a');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            price: 0,
            voucher_token: 'quiz-voucher-token',
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mockEnforcePrizeProductionGuard).toHaveBeenCalledWith({}, false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('passes production approval env into the quiz voucher guard', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId: '11111111-1111-4111-8111-111111111111',
        condition: null,
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockEnforcePrizeProductionGuard).toHaveBeenCalledWith(
      {
        regulatory_basis: 'free_skill_competition',
        regulatory_evidence_ref: 'COUNSEL-2026-08-05',
        regulatory_jurisdiction: 'NG-LA',
      },
      true
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.any(Object)
    );
  });

  it('rejects malformed voucher tokens after the production guard allows the voucher path', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            price: 0,
            voucher_token: 'not-a-valid-voucher-token',
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    // The response identifies the exact rejected token so checkout can prune
    // only the failed line and keep other valid vouchers in a multi-prize cart.
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_TOKEN_INVALID',
      error: 'Invalid quiz voucher token',
      rejectedVoucherToken: 'not-a-valid-voucher-token',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects voucher-backed items with quantity greater than one before order RPC work', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const token = createQuizVoucherToken({
      payload: {
        awardId: '11111111-1111-4111-8111-111111111111',
        condition: null,
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId: '22222222-2222-4222-8222-222222222222',
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            price: 0,
            product_id: '22222222-2222-4222-8222-222222222222',
            quantity: 2,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_QUANTITY_INVALID',
      error: 'Quiz voucher items must have quantity 1',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects a cart with two distinct valid vouchers as a redeemable-one-at-a-time conflict, not an invalid token', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const firstProductId = '22222222-2222-4222-8222-222222222222';
    const secondProductId = '33333333-3333-4333-8333-333333333333';
    const makeToken = (awardId: string, productId: string) =>
      createQuizVoucherToken({
        payload: {
          awardId,
          condition: 'new',
          expiresAt: '2099-05-22T12:00:00.000Z',
          productId,
          userId: AUTH_USER_ID,
          variantId: null,
        },
        secret: 'voucher-secret',
      });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: firstProductId,
            price: 0,
            voucher_token: makeToken(
              '11111111-1111-4111-8111-111111111111',
              firstProductId
            ),
          },
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: secondProductId,
            price: 0,
            voucher_token: makeToken(
              '44444444-4444-4444-8444-444444444444',
              secondProductId
            ),
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_MULTIPLE',
      error: 'Only one quiz voucher can be redeemed per order',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects duplicated lines backed by the same valid voucher token', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });
    const voucherLine = {
      ...baseOrderPayload.items[0],
      condition: 'new',
      product_id: productId,
      price: 0,
      voucher_token: token,
    };

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [voucherLine, voucherLine],
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'QUIZ_VOUCHER_MULTIPLE',
      error: 'Only one quiz voucher can be redeemed per order',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('prunes an unredeemable voucher line instead of reporting a multi-voucher conflict when one award is already claimed', async () => {
    // Regression: a signed token can still be unexpired for an award that is
    // already claimed/void. With 2+ tokens the route must validate award status
    // BEFORE emitting QUIZ_VOUCHER_MULTIPLE (which checkout never prunes) — the
    // bad line should surface a prunable QUIZ_VOUCHER_TOKEN_INVALID so checkout
    // drops just it, not tell the shopper to "redeem one at a time".
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const validAwardId = '11111111-1111-4111-8111-111111111111';
    const claimedAwardId = '44444444-4444-4444-8444-444444444444';
    const supabase = buildMockSupabase(
      {},
      { quizAwardOverrides: { [claimedAwardId]: { status: 'claimed' } } }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const firstProductId = '22222222-2222-4222-8222-222222222222';
    const secondProductId = '33333333-3333-4333-8333-333333333333';
    const makeToken = (awardId: string, productId: string) =>
      createQuizVoucherToken({
        payload: {
          awardId,
          condition: 'new',
          expiresAt: '2099-05-22T12:00:00.000Z',
          productId,
          userId: AUTH_USER_ID,
          variantId: null,
        },
        secret: 'voucher-secret',
      });
    const claimedToken = makeToken(claimedAwardId, secondProductId);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: firstProductId,
            price: 0,
            voucher_token: makeToken(validAwardId, firstProductId),
          },
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: secondProductId,
            price: 0,
            voucher_token: claimedToken,
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_TOKEN_INVALID',
      error: 'Invalid quiz voucher token',
      rejectedVoucherToken: claimedToken,
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns a non-pruning 503 when the award status lookup itself fails', async () => {
    // A transient quiz_awards lookup failure is NOT a bad voucher. Returning the
    // prunable 400 QUIZ_VOUCHER_TOKEN_INVALID would make checkout drop the only
    // prize line and destroy a valid won prize. The route must fail non-prunably
    // (5xx, no rejectedVoucherToken) so the shopper can retry with it intact.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const validAwardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const supabase = buildMockSupabase({}, { quizAwardLookupError: true });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const token = createQuizVoucherToken({
      payload: {
        awardId: validAwardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(503);
    expect(body.code).toBe('QUIZ_VOUCHER_LOOKUP_FAILED');
    // Non-pruning: no rejectedVoucherToken so checkout keeps the prize line.
    expect(body).not.toHaveProperty('rejectedVoucherToken');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('replays an already-paid claimed voucher order without re-finalizing', async () => {
    // A voucher checkout that succeeded but lost its HTTP response leaves the
    // award claimed with a reserved (already paid) order. Retrying must NOT prune
    // the prize as an "invalid voucher" — return the existing order as a replayed
    // success so the shopper reaches their order screen, and NOT touch any RPC.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const reservedOrderId = '99999999-9999-4999-8999-999999999999';
    const supabase = buildMockSupabase(
      {},
      {
        quizAwardOverrides: {
          [awardId]: {
            status: 'claimed',
            reserved_order_id: reservedOrderId,
          },
        },
        claimedReservedOrder: {
          id: reservedOrderId,
          order_number: 'ORD-PRIZE-1',
          tracking_token: 'track-prize-1',
          customer_id: CUSTOMER_ID,
          payment_status: 'paid',
          shipping_status: 'pending',
          total: 0,
        },
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-idempotency-replayed')).toBe('true');
    expect(body.idempotency).toEqual({ replayed: true });
    expect(body.order).toMatchObject({
      id: reservedOrderId,
      order_number: 'ORD-PRIZE-1',
      // Normalized to the settled prize contract regardless of the stored row.
      payment_status: 'paid',
      payment_method: 'quiz_voucher',
    });
    expect(body.amountDueToGateway).toBe(0);
    // No new order is created on the retry.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('replays a claimed voucher for a standard-path prize via order_items.quiz_award_id', async () => {
    // Non-serialized prizes have no reserved_order_id; the claim tags the
    // created order_item with quiz_award_id instead. The retry must still resolve
    // and replay that order rather than prune the prize.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const orderId = '88888888-8888-4888-8888-888888888888';
    const supabase = buildMockSupabase(
      {},
      {
        quizAwardOverrides: {
          // claimed, but no reserved_order_id (standard path).
          [awardId]: { status: 'claimed' },
        },
        claimedOrderItemOrderId: orderId,
        claimedReservedOrder: {
          id: orderId,
          order_number: 'ORD-PRIZE-2',
          customer_id: CUSTOMER_ID,
          payment_status: 'paid',
          shipping_status: 'pending',
          total: 0,
        },
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.idempotency).toEqual({ replayed: true });
    expect(body.order).toMatchObject({
      id: orderId,
      order_number: 'ORD-PRIZE-2',
      payment_method: 'quiz_voucher',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('retries the finalizer when the replayed claimed order is not yet paid', async () => {
    // The claim created the order but died before finalize marked it paid. The
    // replay must retry the finalizer (never fabricate a paid status) and only
    // then return success.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const orderId = '99999999-9999-4999-8999-999999999999';
    const supabase = buildMockSupabase(
      {},
      {
        quizAwardOverrides: {
          [awardId]: { status: 'claimed', reserved_order_id: orderId },
        },
        claimedReservedOrder: {
          id: orderId,
          order_number: 'ORD-PRIZE-3',
          customer_id: CUSTOMER_ID,
          payment_status: 'unpaid',
          shipping_status: 'pending',
          total: 0,
        },
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.order).toMatchObject({ payment_status: 'paid' });
    // The finalizer was retried for the still-unpaid order.
    expect(supabase.rpc).toHaveBeenCalledWith(
      'finalize_quiz_voucher_order_payment',
      { p_award_id: awardId, p_order_id: orderId }
    );
  });

  it('returns a non-pruning 503 when the replay finalizer fails', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const orderId = '99999999-9999-4999-8999-999999999999';
    const supabase = buildMockSupabase(
      {
        finalize_quiz_voucher_order_payment: {
          data: null,
          error: { message: 'finalize failed' },
        },
      },
      {
        quizAwardOverrides: {
          [awardId]: { status: 'claimed', reserved_order_id: orderId },
        },
        claimedReservedOrder: {
          id: orderId,
          order_number: 'ORD-PRIZE-4',
          customer_id: CUSTOMER_ID,
          payment_status: 'unpaid',
          shipping_status: 'pending',
          total: 0,
        },
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });

    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    // Non-pruning: the prize is NOT falsely reported paid or dropped.
    expect(response.status).toBe(503);
    expect(body.code).toBe('QUIZ_VOUCHER_LOOKUP_FAILED');
    expect(body).not.toHaveProperty('rejectedVoucherToken');
  });

  it('returns a non-pruning 503 when the replay orders lookup errors', async () => {
    // A transient failure resolving the claimed award's reserved order must NOT
    // fall through to the invalid-token response (which tells checkout to prune
    // the only prize line for an award the shopper already claimed). Surface a
    // 503 so the retry can find the order once the blip clears.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const reservedOrderId = '99999999-9999-4999-8999-999999999999';
    const supabase = buildMockSupabase(
      {},
      {
        quizAwardOverrides: {
          [awardId]: {
            status: 'claimed',
            reserved_order_id: reservedOrderId,
          },
        },
        claimedReservedOrderError: true,
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(503);
    expect(body.code).toBe('QUIZ_VOUCHER_LOOKUP_FAILED');
    expect(body).not.toHaveProperty('rejectedVoucherToken');
    // Never fabricates a paid order from a failed lookup.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns a non-pruning 503 when the standard-path order_items lookup errors', async () => {
    // Non-serialized prizes resolve the claimed order via order_items; a
    // transient failure there must also fail closed with 503, not prune.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const supabase = buildMockSupabase(
      {},
      {
        quizAwardOverrides: {
          // Claimed, no reserved_order_id → route falls back to order_items.
          [awardId]: { status: 'claimed' },
        },
        claimedOrderItemError: true,
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(503);
    expect(body.code).toBe('QUIZ_VOUCHER_LOOKUP_FAILED');
    expect(body).not.toHaveProperty('rejectedVoucherToken');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('passes the verified voucher award id and paid status for zero-due voucher orders', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase({
      create_storefront_order_with_quiz_voucher: {
        data: [{ ...baseOrderRow, subtotal: 0, total: 0 }],
        error: null,
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        payment_method: 'invoice',
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'new',
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            product_id: productId,
            voucher_award_id: awardId,
          }),
        ],
        p_route_proof: expect.objectContaining({
          action: 'create_storefront_order_with_quiz_voucher',
          subject_id: awardId,
          user_id: AUTH_USER_ID,
        }),
        p_payment_method: 'quiz_voucher',
        p_payment_status: 'unpaid',
        p_user_id: AUTH_USER_ID,
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'finalize_quiz_voucher_order_payment',
      {
        p_award_id: awardId,
        p_order_id: 'order-id',
      }
    );
    await expect(response.json()).resolves.toMatchObject({
      order: {
        payment_method: 'quiz_voucher',
        payment_status: 'paid',
      },
      amountDueToGateway: 0,
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.any(Object)
    );
    expect(generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'quiz_voucher' })
    );
    expect(mockGeneratePaymentAccount).not.toHaveBeenCalled();
    // Multi-country currency reads the stamped orders.currency back via the
    // service-role client (server-derived id, read-only) for voucher orders too.
    // The security intent — no admin-client order CREATION — is covered by the
    // create_storefront_order and payment-account assertions above.
    expect(mockCreateAdminClient).toHaveBeenCalled();
  });

  it('records the real VAT on a voucher order (merchant absorbs it) and leaves nothing due', async () => {
    // For a VAT-registered merchant the voucher RPC delegates to
    // create_storefront_order, which recomputes VAT from the catalog price and
    // raises tax_amount_mismatch if we send 0. So the order must carry the REAL
    // recomputed VAT (prod-verified: p_tax_amount must equal v_expected_tax).
    // The voucher covers the product and the merchant absorbs the VAT, so the
    // shopper still owes nothing (amountDueToGateway 0).
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const supabase = buildMockSupabase(
      {
        create_storefront_order_with_quiz_voucher: {
          // Merchant absorbs the VAT: subtotal = catalog, total = VAT.
          data: [{ ...baseOrderRow, subtotal: 1000, total: 75 }],
          error: null,
        },
      },
      {
        merchantVatRegistrationStatus: 'registered',
        productRows: [
          {
            id: productId,
            name: 'Prize Phone',
            price: 1000,
            vat_category_code: 'S',
            vat_rate: 7.5,
          },
        ],
      }
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.objectContaining({
        p_payment_method: 'quiz_voucher',
        p_payment_status: 'unpaid',
        // The REAL recomputed VAT (1000 * 7.5% = 75), not 0 — otherwise the RPC
        // raises tax_amount_mismatch for a VAT-registered merchant.
        p_tax_amount: 75,
        // Server-computed expected total = absorbed VAT + shipping + gift (75 +
        // 0 + 0). This arms the RPC's parity gate so a mid-window catalog price
        // change (award no longer covers the product) rolls back atomically
        // instead of burning the award on a residual order.
        p_expected_total: 75,
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'finalize_quiz_voucher_order_payment',
      {
        p_award_id: awardId,
        p_order_id: 'order-id',
      }
    );
    expect(body).toMatchObject({
      order: {
        payment_method: 'quiz_voucher',
        payment_status: 'paid',
      },
      amountDueToGateway: 0,
    });
  });

  it('normalizes zero-due voucher POD orders away from pay-on-delivery before the voucher RPC', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase({
      create_storefront_order_with_quiz_voucher: {
        data: [{ ...baseOrderRow, subtotal: 0, total: 0 }],
        error: null,
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          payment_method: 'pod',
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.objectContaining({
        p_payment_method: 'quiz_voucher',
        p_payment_status: 'unpaid',
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'finalize_quiz_voucher_order_payment',
      {
        p_award_id: awardId,
        p_order_id: 'order-id',
      }
    );
  });

  it('rejects mixed voucher carts before voucher RPC work', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const voucherProductId = '22222222-2222-4222-8222-222222222222';
    const paidProductId = '33333333-3333-4333-8333-333333333333';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId: voucherProductId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              price: 0,
              product_id: voucherProductId,
              voucher_token: token,
            },
            {
              ...baseOrderPayload.items[0],
              name: 'Residual item',
              price: 1500,
              product_id: paidProductId,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'QUIZ_VOUCHER_MIXED_CART_UNSUPPORTED',
      error: 'Quiz prize vouchers must be checked out separately',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.any(Object)
    );
  });

  it('absorbs the delivery fee on a voucher-only cart (merchant covers it) and leaves nothing due', async () => {
    // Physical prizes ship: the merchant absorbs the delivery fee (like VAT), so
    // a nonzero shipping quote is NOT a shopper residual. The order records the
    // shipping (total = shipping here, no VAT) and redeems with nothing due.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase({
      create_storefront_order_with_quiz_voucher: {
        // Award covers the product; only the absorbed shipping remains as total.
        data: [
          { ...baseOrderRow, subtotal: 1000, shipping_fee: 1500, total: 1500 },
        ],
        error: null,
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_fee: 1500,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              price: 0,
              product_id: productId,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    // The voucher RPC runs and records the real shipping fee, and the
    // server-computed expected total is the absorbed VAT + shipping + gift
    // (0 + 1500 + 0) so the RPC's parity gate still fires on a residual.
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.objectContaining({ p_shipping_fee: 1500, p_expected_total: 1500 })
    );
    // The shopper owes nothing — the merchant absorbs the delivery.
    expect(body.amountDueToGateway).toBe(0);
  });

  it('never debits the wallet on a voucher order, even when wallet credit is toggled', async () => {
    // A voucher order's `orderTotal` is only the merchant-absorbed VAT/delivery,
    // never a shopper charge. If a shopper also toggled wallet credit, the
    // wallet redemption block must be skipped (like savings) so the absorbed
    // cost is not charged against their wallet balance.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase({
      create_storefront_order_with_quiz_voucher: {
        // Award covers the product; the absorbed delivery is the only total.
        data: [
          { ...baseOrderRow, subtotal: 1000, shipping_fee: 1500, total: 1500 },
        ],
        error: null,
      },
      // If the (buggy) path ran, this would redeem 1500 against the wallet.
      redeem_wallet_for_order: {
        data: [
          {
            success: true,
            redeemed_amount: 1500,
            new_balance: 0,
            transaction_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
          },
        ],
        error: null,
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_fee: 1500,
          use_wallet_credit: true,
          wallet_amount: 1500,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              price: 0,
              product_id: productId,
              voucher_token: token,
            },
          ],
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    // The wallet is never touched for a voucher order.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'redeem_wallet_for_order',
      expect.anything()
    );
    expect(body.wallet ?? null).toBeNull();
    expect(body.amountDueToGateway).toBe(0);
  });

  it('maps voucher RPC client errors to a checkout-correctable 400', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase({
      create_storefront_order_with_quiz_voucher: {
        data: null,
        error: { message: 'quiz_voucher_award_not_approved' },
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: null,
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      details: 'quiz_voucher_award_not_approved',
      error: 'Failed to create order',
    });
  });
});

describe('POST /api/orders — wallet response shape', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => buildMockSupabase() as unknown as never
    );
  });

  it('returns wallet=null and full amountDueToGateway when wallet is not used', async () => {
    // Pin: orders that do not opt into wallet have no wallet block in the
    // response and the gateway is asked for the full order total.
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(baseOrderPayload),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.wallet).toBeNull();
    expect(body.amountDueToGateway).toBe(1000);
    expect(body.order).toEqual(
      expect.objectContaining({
        id: 'order-id',
        order_number: 'ORD-123',
        // The stamped order currency must be surfaced so checkout can send
        // the ORDER's currency (not the merchant's current one) to payment
        // initialization — reused orders keep their original stamp.
        currency: 'NGN',
      })
    );
  });

  it('partial wallet redemption surfaces wallet { amountUsed, newBalance, transactionId } and residual amountDueToGateway', async () => {
    // Pin the partial-coverage response shape that the mobile checkout's
    // success screen consumes (wallet.amountUsed + amountDueToGateway).
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          redeem_wallet_for_order: {
            data: [
              {
                success: true,
                redeemed_amount: 300,
                new_balance: 200,
                transaction_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
              },
            ],
            error: null,
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        use_wallet_credit: true,
        wallet_amount: 300,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.wallet).toEqual({
      amountUsed: 300,
      newBalance: 200,
      transactionId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    });
    expect(body.amountDueToGateway).toBe(700);
    // The redemption is persisted onto the order row so payment webhooks can
    // validate the residual gateway payout.
    expect(mockRecordPreGatewayRedemption).toHaveBeenCalledWith(
      expect.any(String),
      1000,
      0,
      300
    );
  });

  it('applies savings before wallet and returns the combined residual', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          redeem_savings_for_order: {
            data: [
              {
                goal_id: '123e4567-e89b-12d3-a456-426614174555',
                goal_status: 'paused',
                redeemed_amount: 500,
                redemption_id: '77777777-aaaa-bbbb-cccc-dddddddddddd',
                remaining_goal_amount: 1500,
                success: true,
              },
            ],
            error: null,
          },
          redeem_wallet_for_order: {
            data: [
              {
                success: true,
                redeemed_amount: 300,
                new_balance: 200,
                transaction_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
              },
            ],
            error: null,
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': 'checkout-retry-key-1',
        },
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 500,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
          use_wallet_credit: true,
          wallet_amount: 300,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.savings).toEqual({
      amountUsed: 500,
      goalId: '123e4567-e89b-12d3-a456-426614174555',
      redemptionId: '77777777-aaaa-bbbb-cccc-dddddddddddd',
    });
    expect(body.wallet).toEqual({
      amountUsed: 300,
      newBalance: 200,
      transactionId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    });
    expect(body.amountDueToGateway).toBe(200);
  });

  it('creates savings checkout orders through the atomic savings order RPC', async () => {
    const rpcSpy = vi.fn();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        create_storefront_order_with_savings: {
          data: [createOrderWithSavingsRow({ redeemedAmount: 500 })],
          error: null,
        },
      });
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        rpcSpy(name, params);
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': 'checkout-retry-key-1',
        },
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 500,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(rpcSpy).toHaveBeenCalledWith(
      'create_storefront_order_with_savings',
      expect.objectContaining({
        p_savings_amount: 500,
        p_savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        p_savings_idempotency_key: 'order:checkout-retry-key-1:savings',
      })
    );
    expect(rpcSpy).not.toHaveBeenCalledWith(
      'redeem_savings_for_order',
      expect.anything()
    );
  });

  it('fails explicit savings checkout when savings redemption is rejected', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    const finalizeSpy = vi.fn((_params?: unknown) =>
      Promise.resolve({ data: null, error: null })
    );
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        redeem_savings_for_order: {
          data: null,
          error: {
            code: 'P0001',
            message: 'savings_goal_does_not_match_order',
          },
        },
      });
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string) => {
        if (name === 'finalize_store_credit_order_payment') {
          return finalizeSpy();
        }
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 500,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(409);
    expect(body).toEqual({
      code: 'P0001',
      error: 'savings_goal_does_not_match_order',
    });
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it('full savings coverage returns amountDueToGateway=0 and finalizes as savings', async () => {
    const finalizeSpy = vi.fn((_params?: unknown) =>
      Promise.resolve({ data: null, error: null })
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        redeem_savings_for_order: {
          data: [
            {
              goal_id: '123e4567-e89b-12d3-a456-426614174555',
              goal_status: 'spent',
              redeemed_amount: 1000,
              redemption_id: '77777777-aaaa-bbbb-cccc-dddddddddddd',
              remaining_goal_amount: 0,
              success: true,
            },
          ],
          error: null,
        },
      });
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        if (name === 'finalize_store_credit_order_payment') {
          return finalizeSpy(params);
        }
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 1000,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.amountDueToGateway).toBe(0);
    expect(body.order.payment_status).toBe('paid');
    expect(body.order.payment_method).toBe('savings');
    expect(body.savings.amountUsed).toBe(1000);
    expect(finalizeSpy).toHaveBeenCalledWith({
      p_amount: 1000,
      p_order_id: 'order-id',
      p_payment_method: 'savings',
    });
  });

  it('does not return a zero gateway residual when full savings finalization fails', async () => {
    const finalizeSpy = vi.fn((_params?: unknown) =>
      Promise.resolve({
        data: null,
        error: {
          code: 'P0001',
          message: 'store_credit_finalize_failed',
        },
      })
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        redeem_savings_for_order: {
          data: [
            {
              goal_id: '123e4567-e89b-12d3-a456-426614174555',
              goal_status: 'spent',
              redeemed_amount: 1000,
              redemption_id: '77777777-aaaa-bbbb-cccc-dddddddddddd',
              remaining_goal_amount: 0,
              success: true,
            },
          ],
          error: null,
        },
      });
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        if (name === 'finalize_store_credit_order_payment') {
          return finalizeSpy(params);
        }
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 1000,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(409);
    expect(body).toEqual({
      code: 'STORE_CREDIT_FINALIZE_FAILED',
      error: 'store_credit_finalize_failed',
      orderId: 'order-id',
    });
    expect(finalizeSpy).toHaveBeenCalledWith({
      p_amount: 1000,
      p_order_id: 'order-id',
      p_payment_method: 'savings',
    });
  });

  it('full-coverage wallet redemption returns amountDueToGateway=0 and finalizes payment', async () => {
    // Pin the full-coverage path that the mobile client uses to skip the
    // gateway initialize step entirely. Order is marked paid via
    // finalize_wallet_order_payment.
    const finalizeSpy = vi.fn(() =>
      Promise.resolve({ data: null, error: null })
    );
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        redeem_wallet_for_order: {
          data: [
            {
              success: true,
              redeemed_amount: 1000,
              new_balance: 0,
              transaction_id: '88888888-aaaa-bbbb-cccc-eeeeeeeeeeee',
            },
          ],
          error: null,
        },
      });
      // Wrap rpc so we can spy on finalize_wallet_order_payment specifically.
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string) => {
        if (name === 'finalize_wallet_order_payment') {
          return finalizeSpy();
        }
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        use_wallet_credit: true,
        wallet_amount: 1000,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.wallet).toEqual({
      amountUsed: 1000,
      newBalance: 0,
      transactionId: '88888888-aaaa-bbbb-cccc-eeeeeeeeeeee',
    });
    expect(body.amountDueToGateway).toBe(0);
    expect(body.order.payment_status).toBe('paid');
    expect(body.order.payment_method).toBe('wallet');
    expect(finalizeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/orders — non-NGN currency guards', () => {
  // Routes the `merchants` fetch to a payout-currency-aware fixture and the
  // `orders` currency read-back to a stamped row, leaving every other table
  // on the shared buildMockSupabase chainable.
  function buildCurrencyAwareSupabase({
    merchantPayoutCurrency,
    orderRowCurrency,
    rpcOverrides = {},
    rpcSpy,
  }: {
    merchantPayoutCurrency?: string;
    orderRowCurrency?: string;
    rpcOverrides?: Parameters<typeof buildMockSupabase>[0];
    rpcSpy?: (name: string, params?: unknown) => void;
  }) {
    const sb = buildMockSupabase(rpcOverrides);
    const originalFrom = sb.from;
    const merchantRow = {
      id: MERCHANT_ID,
      business_name: 'Test Merchant',
      country: 'NG',
      slug: 'test-merchant',
      support_email: 'support@example.com',
      email_sender_name: 'Test Store',
      email: 'merchant@example.com',
      ...(merchantPayoutCurrency
        ? { payout_currency: merchantPayoutCurrency }
        : {}),
    };
    const merchantsChainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: merchantRow, error: null }),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: merchantRow, error: null }),
    };
    const ordersChainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: orderRowCurrency ? { currency: orderRowCurrency } : null,
        error: null,
      }),
    };
    sb.from = vi.fn((table: string) => {
      if (table === 'merchants') return merchantsChainable;
      if (table === 'orders') return ordersChainable;
      return originalFrom(table);
    }) as typeof sb.from;
    // The stamped-currency read-back now goes through the service-role
    // client, so the stamped row must be served from the admin mock.
    primeAdminOrderCurrencyRead(orderRowCurrency ?? null);
    if (rpcSpy) {
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        rpcSpy(name, params);
        return originalRpc(name);
      }) as typeof sb.rpc;
    }
    return sb;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('falls back to the plain order RPC and skips savings when the merchant currency is not NGN', async () => {
    const rpcSpy = vi.fn();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() =>
      buildCurrencyAwareSupabase({
        merchantPayoutCurrency: 'GHS',
        rpcSpy,
      })) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 500,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.savings).toBeNull();
    expect(rpcSpy).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.not.objectContaining({ p_savings_amount: expect.anything() })
    );
    expect(rpcSpy).not.toHaveBeenCalledWith(
      'create_storefront_order_with_savings',
      expect.anything()
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Savings redemption skipped: order currency is not NGN',
        orderCurrency: 'GHS',
        savingsGoalId: '123e4567-e89b-12d3-a456-426614174555',
      })
    );
  });

  it('governs the wallet NGN guard by the stamped order row currency, not the current merchant', async () => {
    // Replay divergence: the merchant has since switched payout to GHS, but
    // the (replayed) order row was stamped NGN — the wallet guard must follow
    // the row, so the naira wallet still redeems against the naira order.
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() =>
      buildCurrencyAwareSupabase({
        merchantPayoutCurrency: 'GHS',
        orderRowCurrency: 'NGN',
        rpcOverrides: {
          redeem_wallet_for_order: {
            data: [
              {
                success: true,
                redeemed_amount: 300,
                new_balance: 200,
                transaction_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
              },
            ],
            error: null,
          },
        },
      })) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          use_wallet_credit: true,
          wallet_amount: 300,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.wallet).toEqual({
      amountUsed: 300,
      newBalance: 200,
      transactionId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Wallet redemption skipped: order currency is not NGN',
      })
    );
  });

  it('skips wallet redemption when the stamped order row currency is not NGN', async () => {
    const rpcSpy = vi.fn();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() =>
      buildCurrencyAwareSupabase({
        orderRowCurrency: 'GHS',
        rpcOverrides: {
          redeem_wallet_for_order: {
            data: [
              {
                success: true,
                redeemed_amount: 300,
                new_balance: 200,
                transaction_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
              },
            ],
            error: null,
          },
        },
        rpcSpy,
      })) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          use_wallet_credit: true,
          wallet_amount: 300,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    expect(body.wallet).toBeNull();
    expect(body.amountDueToGateway).toBe(1000);
    expect(rpcSpy).not.toHaveBeenCalledWith(
      'redeem_wallet_for_order',
      expect.anything()
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Wallet redemption skipped: order currency is not NGN',
        orderCurrency: 'GHS',
      })
    );
  });
});

describe('POST /api/orders — checkout idempotency', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => buildMockSupabase() as unknown as never
    );
  });

  it('passes checkout idempotency params to the storefront order RPC', async () => {
    const rpcSpy = vi.fn();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        if (name === 'create_storefront_order') {
          rpcSpy(params);
        }
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          payment_method: 'credit_direct',
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_checkout_idempotency_key: 'checkout-key-1',
        p_checkout_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
  });

  it('returns replay metadata, residual gateway amount, and skips duplicate wallet-paid notifications', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: [
              {
                ...baseOrderRow,
                idempotency_replayed: true,
                payment_method: 'credit_direct',
                payment_status: 'bnpl_pending',
                total: 300,
              },
            ],
            error: null,
          },
          redeem_wallet_for_order: {
            data: [
              {
                success: true,
                redeemed_amount: 300,
                new_balance: 200,
                transaction_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
              },
            ],
            error: null,
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          payment_method: 'credit_direct',
          use_wallet_credit: true,
          wallet_amount: 300,
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-idempotency-replayed')).toBe('true');
    expect(body.idempotency).toEqual({ replayed: true });
    expect(body.wallet).toEqual({
      amountUsed: 300,
      newBalance: 200,
      transactionId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    });
    expect(body.amountDueToGateway).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockNotifyNewOrder).not.toHaveBeenCalled();
    expect(mockNotifyPaymentReceived).not.toHaveBeenCalled();
  });

  it('replays a metadata-free provider order after its quote was deleted', async () => {
    const rpcSpy = vi.fn();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        has_storefront_order_idempotency_key: { data: true, error: null },
        get_checkout_shipping_quote: { data: null, error: null },
        create_storefront_order: {
          data: [{ ...baseOrderRow, idempotency_replayed: true }],
          error: null,
        },
      });
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        rpcSpy(name, params);
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'metadata-free-provider-retry' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_fee: 18_500,
          selected_quote_id: '11111111-1111-4111-8111-111111111111',
          shipping_provider: 'GIGL',
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-idempotency-replayed')).toBe('true');
    expect(body.idempotency).toEqual({ replayed: true });
    expect(body.order.id).toBe(baseOrderRow.id);
    expect(rpcSpy).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_checkout_idempotency_key: 'metadata-free-provider-retry',
        p_selected_quote_id: '11111111-1111-4111-8111-111111111111',
        p_shipping_provider: 'GIGL',
        p_shipping_fee: 18_500,
      })
    );
  });

  it('passes checkout idempotency params through the savings wrapper RPC', async () => {
    const rpcSpy = vi.fn();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase({
        create_storefront_order_with_savings: {
          data: [
            {
              ...baseOrderRow,
              idempotency_replayed: true,
              savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
              savings_goal_status: 'paused',
              savings_redeemed_amount: 500,
              savings_redemption_id: '77777777-aaaa-bbbb-cccc-dddddddddddd',
              savings_redemption_success: true,
            },
          ],
          error: null,
        },
      });
      const originalRpc = sb.rpc;
      sb.rpc = vi.fn((name: string, params?: unknown) => {
        rpcSpy(name, params);
        return originalRpc(name);
      });
      return sb;
    }) as unknown as never);

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          savings_amount: 500,
          savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
          use_savings_credit: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith(
      'create_storefront_order_with_savings',
      expect.objectContaining({
        p_checkout_idempotency_key: 'checkout-key-1',
        p_checkout_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_savings_idempotency_key: 'order:checkout-key-1:savings',
      })
    );
  });

  it('does not pass checkout idempotency params through the quiz voucher wrapper RPC', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const awardId = '11111111-1111-4111-8111-111111111111';
    const productId = '22222222-2222-4222-8222-222222222222';
    const token = createQuizVoucherToken({
      payload: {
        awardId,
        condition: 'new',
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              ...baseOrderPayload.items[0],
              condition: 'new',
              price: 0,
              product_id: productId,
              voucher_token: token,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(201);
    const quizRpcCall = vi
      .mocked(supabase.rpc)
      .mock.calls.find(
        ([name]) => name === 'create_storefront_order_with_quiz_voucher'
      ) as [string, Record<string, unknown>] | undefined;
    if (!quizRpcCall) {
      throw new Error('Expected quiz voucher RPC to be called');
    }
    const [, quizRpcParams] = quizRpcCall;
    expect(quizRpcParams).not.toHaveProperty('p_checkout_idempotency_key');
    expect(quizRpcParams).not.toHaveProperty('p_checkout_request_hash');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.objectContaining({
        p_route_proof: expect.objectContaining({
          action: 'create_storefront_order_with_quiz_voucher',
          subject_id: awardId,
          user_id: AUTH_USER_ID,
        }),
      })
    );
  });

  it('treats a BNPL provider switch as an order replay, not a new order', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: [
              {
                ...baseOrderRow,
                idempotency_replayed: true,
                payment_method: 'card',
                payment_status: 'unpaid',
              },
            ],
            error: null,
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          payment_method: 'card',
        }),
      })
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.order.id).toBe('order-id');
    expect(body.order.payment_method).toBe('card');
    expect(body.idempotency).toEqual({ replayed: true });
  });

  it('maps checkout idempotency conflicts to 409', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { code: 'P0001', message: 'checkout_idempotency_conflict' },
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          payment_method: 'credit_direct',
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
      error:
        'This checkout request was already used for a different cart, customer, or delivery payload.',
    });
  });

  it('maps reusable-order conflicts to 409', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { code: 'P0001', message: 'order_not_reusable' },
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          payment_method: 'credit_direct',
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'CHECKOUT_ORDER_NOT_REUSABLE',
      error:
        'This checkout order can no longer be reused. Refresh checkout and start a new order.',
    });
  });
});

describe('POST /api/orders — product cache revalidation after order creation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => buildMockSupabase() as unknown as never
    );
  });

  it('revalidates the merchant product caches once after a successful order', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(baseOrderPayload),
      })
    );

    expect(response.status).toBe(201);
    expect(mockRevalidateProducts).toHaveBeenCalledExactlyOnceWith(MERCHANT_ID);
  });

  it('resolves the touched product slugs and revalidates their per-slug PDP caches', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase(
          {},
          { productRows: [{ id: 'p-1', price: 1000, slug: 'test-widget' }] }
        ) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(baseOrderPayload),
      })
    );

    expect(response.status).toBe(201);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledExactlyOnceWith(
      MERCHANT_ID,
      ['test-widget']
    );
  });

  it('logs and still returns a successful order when the slug lookup fails', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(() => {
      const supabase = buildMockSupabase();
      const originalFrom = supabase.from;
      supabase.from = vi.fn((table: string) => {
        const original = originalFrom(table);
        if (table !== 'products') {
          return original;
        }
        // Only the slug-revalidation lookup selects exactly 'slug' — the
        // pre-existing tax/negotiation product lookup selects other columns
        // and must keep resolving via the default chain.
        const select = vi.fn((columns: string) =>
          columns === 'slug'
            ? {
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockReturnThis(),
                returns: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'db down' },
                }),
              }
            : original.select(columns)
        );
        return { ...original, select };
      });
      return supabase as unknown as never;
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(baseOrderPayload),
      })
    );

    expect(response.status).toBe(201);
    expect(mockRevalidateProducts).toHaveBeenCalledExactlyOnceWith(MERCHANT_ID);
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve product slugs for PDP cache revalidation',
      })
    );
  });

  it('does not revalidate when the order RPC returns an error', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { message: 'insufficient_stock' },
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(baseOrderPayload),
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('does not revalidate on an idempotent replay (no re-decrement occurred)', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: [{ ...baseOrderRow, idempotency_replayed: true }],
            error: null,
          },
        }) as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'checkout-key-1' },
        body: JSON.stringify(baseOrderPayload),
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
  });

  it('still returns a successful order when revalidateProducts throws', async () => {
    mockRevalidateProducts.mockImplementationOnce(() => {
      throw new Error('revalidate boom');
    });

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(baseOrderPayload),
      })
    );

    expect(response.status).toBe(201);
    expect(mockRevalidateProducts).toHaveBeenCalledExactlyOnceWith(MERCHANT_ID);
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders — discount guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => buildMockSupabase() as unknown as never
    );
  });

  it('rejects any non-zero client discount amount', async () => {
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        discount_amount: 50,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: 'discount_amount_not_supported',
      error: 'Failed to create order',
    });
  });
});

describe('POST /api/orders — selected shipping quote validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('validates selected GIGL international quote items against canonical products', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        productRows: [
          {
            id: 'p-2',
            name: 'Laptop',
            price: 500_000,
            vat_category_code: 'S',
            vat_rate: 0,
          },
        ],
        shippingQuote: {
          provider: 'GIGL',
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          price: 4500,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          quote_request: {
            merchantId: MERCHANT_ID,
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Customer',
              phone: '+14165550123',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500_000 }],
          },
        },
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              product_id: 'p-2',
              name: 'Phone',
              quantity: 1,
              price: 500_000,
            },
          ],
          subtotal: 500_000,
          shipping_fee: 4500,
          selected_quote_id: '11111111-1111-4111-8111-111111111111',
          shipping_provider: 'GIGL',
          shipping_address: {
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('allows selected GIGL international quotes to keep quoted physical metadata when product metadata is absent', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        productRows: [
          {
            id: 'p-1',
            name: 'Phone',
            price: 500_000,
            vat_category_code: 'S',
            vat_rate: 0,
          },
        ],
        shippingQuote: {
          provider: 'GIGL',
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          price: 4500,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          quote_request: {
            merchantId: MERCHANT_ID,
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Customer',
              phone: '+14165550123',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [
              {
                name: 'Phone',
                quantity: 1,
                weight: 1,
                value: 500_000,
                hsCode: '851712',
                length: 10,
                width: 8,
                height: 6,
              },
            ],
          },
        },
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              product_id: 'p-1',
              name: 'Phone',
              quantity: 1,
              price: 500_000,
            },
          ],
          subtotal: 500_000,
          shipping_fee: 4500,
          selected_quote_id: '11111111-1111-4111-8111-111111111111',
          shipping_provider: 'GIGL',
          shipping_address: {
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_selected_quote_id: '11111111-1111-4111-8111-111111111111',
        p_shipping_provider: 'GIGL',
      })
    );
  });

  it('rejects selected GIGL international quotes with stale product shipping metadata', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        productRows: [
          {
            id: 'p-1',
            name: 'Phone',
            price: 500_000,
            vat_category_code: 'S',
            vat_rate: 0,
            weight_unit: 'kg',
            weight_value: 2,
          },
        ],
        shippingQuote: {
          provider: 'GIGL',
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          price: 4500,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          quote_request: {
            merchantId: MERCHANT_ID,
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Customer',
              phone: '+14165550123',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500_000 }],
          },
        },
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...baseOrderPayload,
          items: [
            {
              product_id: 'p-1',
              name: 'Phone',
              quantity: 1,
              price: 500_000,
            },
          ],
          subtotal: 500_000,
          shipping_fee: 4500,
          selected_quote_id: '11111111-1111-4111-8111-111111111111',
          shipping_provider: 'GIGL',
          shipping_address: {
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });
});

describe('POST /api/orders — per-line eligible discount enforcement', () => {
  // Returns { rpcSpy }. `products` is the catalog rows the discount loader sees.
  async function setupOrdersDiscountMock(products: Record<string, unknown>[]) {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'order_total_mismatch' },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: 'pro',
                      slug: 'ogabassey',
                      vat_registration_status: 'registered',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({ data: products, error: null }),
                  overrideTypes: () =>
                    Promise.resolve({ data: products, error: null }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);
    return { rpcSpy };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('rejects a non-negotiable line priced below catalog before calling the RPC', async () => {
    const { rpcSpy } = await setupOrdersDiscountMock([
      {
        id: 'p-tecno',
        brand: 'Tecno',
        name: 'Tecno Spark 50',
        price: 500,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-tecno',
            quantity: 1,
            price: 480,
            name: 'Tecno Spark 50',
          },
        ],
        subtotal: 480,
        tax_amount: 36,
        expected_total: 516,
        client_total: 516,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toBe('non_negotiable_line_discounted');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('derives the eligible-line discount for a mixed negotiable/non-negotiable cart', async () => {
    // MacBook 1000 (negotiable) → client 980; Tecno 500 (non-negotiable) at catalog.
    // Per-line: MacBook reduction 20 +7.5% VAT = 21.5 (≤ cap 21.5); Tecno 0 →
    // p_discount_amount 21.5. RPC stubbed to error after arg capture.
    const { rpcSpy } = await setupOrdersDiscountMock([
      {
        id: 'p-mac',
        brand: 'Apple',
        name: 'MacBook Air M1',
        price: 1000,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
      {
        id: 'p-tecno',
        brand: 'Tecno',
        name: 'Tecno Spark 50',
        price: 500,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-mac',
            quantity: 1,
            price: 980,
            name: 'MacBook Air M1',
          },
          {
            product_id: 'p-tecno',
            quantity: 1,
            price: 500,
            name: 'Tecno Spark 50',
          },
        ],
        subtotal: 1480,
        tax_amount: 112.5,
        expected_total: 1591,
        client_total: 1591,
      }),
    });

    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_discount_amount: 21.5,
        p_expected_total: 1591,
      })
    );
  });

  it('rejects a negotiable line priced below the 2% floor, closing the assurance channel', async () => {
    // 5% below catalog WITH assurance on the line. /api/orders derives assurance
    // from the line price, so without the floor reject the assurance fee would be
    // an uncapped discount. The reject blocks the order before the RPC.
    const { rpcSpy } = await setupOrdersDiscountMock([
      {
        id: 'p-mac',
        brand: 'Apple',
        name: 'MacBook Air M1',
        price: 1000,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-mac',
            quantity: 1,
            price: 950,
            name: 'MacBook Air M1',
            has_assurance: true,
          },
        ],
        subtotal: 950,
        tax_amount: 71.25,
        expected_total: 1069.5,
        client_total: 1069.5,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toBe('negotiated_price_below_floor');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('validates per-line prices even when expected_total is omitted', async () => {
    // The assurance-fee bypass: a direct caller omits expected_total, under-prices
    // an assurance-bearing line, and the RPC would otherwise charge a reduced
    // assurance fee. Validation must run regardless of expected_total.
    const { rpcSpy } = await setupOrdersDiscountMock([
      {
        id: 'p-mac',
        brand: 'Apple',
        name: 'MacBook Air M1',
        price: 1000,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-mac',
            quantity: 1,
            price: 950,
            name: 'MacBook Air M1',
            has_assurance: true,
          },
        ],
        subtotal: 950,
        tax_amount: 71.25,
        expected_total: undefined, // omitted on the wire
        client_total: undefined,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toBe('negotiated_price_below_floor');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('does not reject a within-floor assurance line and carries no discount when expected_total is omitted', async () => {
    // A negotiable line priced exactly 2% below catalog (within floor) WITH
    // assurance, but expected_total OMITTED. The loader returns a valid 21.5
    // discount (no rejection), yet the route only APPLIES a derived discount
    // when expected_total is a number — so the order is NOT rejected and the
    // RPC receives p_discount_amount: 0 (the line is charged at catalog).
    const { rpcSpy } = await setupOrdersDiscountMock([
      {
        id: 'p-mac',
        brand: 'Apple',
        name: 'MacBook Air M1',
        price: 1000,
        vat_category_code: 'S',
        vat_rate: 7.5,
      },
    ]);
    // Let the order succeed so we can assert the request is NOT rejected.
    rpcSpy.mockResolvedValue({ data: [baseOrderRow], error: null });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-mac',
            quantity: 1,
            price: 980,
            name: 'MacBook Air M1',
            has_assurance: true,
          },
        ],
        subtotal: 980,
        tax_amount: 73.5,
        // expected_total intentionally omitted on the wire.
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({ p_discount_amount: 0 })
    );
  });

  it('skips negotiation validation for a verified voucher line even when its product is loaded', async () => {
    // Sibling of the voucher success test: the products select WOULD return the
    // award product (price 5000 ≫ client 0), but the loader exempts
    // voucher_award_id lines, so the negotiation reject never fires and the
    // voucher RPC still runs.
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'yes');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
    const supabase = buildMockSupabase();
    const productId = '22222222-2222-4222-8222-222222222222';
    supabase.from = vi.fn((table: string) => {
      if (table === 'products') {
        const productsChain: Record<string, unknown> = {
          select: () => productsChain,
          eq: () => productsChain,
          in: () => productsChain,
          returns: () =>
            Promise.resolve({
              data: [
                {
                  id: productId,
                  brand: 'Apple',
                  name: 'Free Gift',
                  price: 5000,
                  vat_category_code: 'S',
                  vat_rate: 7.5,
                },
              ],
              error: null,
            }),
          overrideTypes: () =>
            Promise.resolve({
              data: [
                {
                  id: productId,
                  brand: 'Apple',
                  name: 'Free Gift',
                  price: 5000,
                  vat_category_code: 'S',
                  vat_rate: 7.5,
                },
              ],
              error: null,
            }),
        };
        return productsChain;
      }
      return buildMockSupabase().from(table);
    }) as typeof supabase.from;
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    mockEnforcePrizeProductionGuard.mockImplementation(
      (_event, complianceVerified) => {
        if (!complianceVerified) {
          throw new MockQuizProductionNotApprovedError();
        }
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    const token = createQuizVoucherToken({
      payload: {
        awardId: '11111111-1111-4111-8111-111111111111',
        condition: null,
        expiresAt: '2099-05-22T12:00:00.000Z',
        productId,
        userId: AUTH_USER_ID,
        variantId: null,
      },
      secret: 'voucher-secret',
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            product_id: productId,
            price: 0,
            voucher_token: token,
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_quiz_voucher',
      expect.any(Object)
    );
  });
});

describe('POST /api/orders — B3.5 client/server total parity', () => {
  // Codex P1 (PR #1622): the parity check moved INTO the RPC so a
  // mismatch rolls back the transaction atomically BEFORE the order
  // is inserted or stock is decremented. The route's job is just to
  // forward `p_expected_total` and map the RAISE to a 400.
  beforeEach(async () => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => buildMockSupabase() as unknown as never
    );
  });

  it('forwards expected_total as p_expected_total to the RPC', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        expected_total: 1000,
        client_total: 1000,
      }),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({ p_expected_total: 1000 })
    );
  });

  it('passes null p_expected_total when the client omits it (legacy callers)', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(baseOrderPayload),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({ p_expected_total: null })
    );
  });

  it('maps RPC order_total_mismatch to 400 (no orphan order, no stock leak)', async () => {
    // When the RPC RAISES `order_total_mismatch` it does so BEFORE
    // the orders INSERT and stock UPDATEs, so the whole transaction
    // rolls back. Mapping to 400 (instead of the pre-Codex 409
    // returned post-side-effect) lets the storefront treat this as
    // a clean validation failure: re-render the order summary,
    // re-submit. No risk of duplicate orders.
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { code: 'P0001', message: 'order_total_mismatch' },
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        expected_total: 1500,
      }),
    });
    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toContain('order_total_mismatch');
  });

  it('server-computes quantity-aware assurance_fee and forwards it to the RPC', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000000,
          subtotal: 1000000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-1',
            quantity: 2,
            price: 333.33,
            name: 'Widget',
            has_assurance: true,
          },
        ],
        expected_total: 666.66,
        client_total: 666.66,
      }),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            product_id: 'p-1',
            quantity: 2,
            price: 333.33,
            has_assurance: true,
            assurance_fee: 33.33, // (333.33 * 2) * 0.05 rounded to 2 decimals
          }),
        ],
      })
    );
  });

  it('does not persist condition fallback as a raw variant label for normal orders', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'used',
          },
        ],
      }),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            condition: 'used',
            variant_name: undefined,
          }),
        ],
      })
    );
  });

  it('prefers explicit variant labels over derived variant attributes for normal orders', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            variantName: 'Grade A / 512GB',
            variantAttributes: { storage: '512GB' },
          },
        ],
      }),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            variant_attributes: { storage: '512GB' },
            variant_name: 'Grade A / 512GB',
          }),
        ],
      })
    );
  });
});

describe('POST /api/orders — B3.5 VAT RPC error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('maps tax_amount_mismatch to 400 with structured details', async () => {
    // Surface the RPC's RAISE EXCEPTION 'tax_amount_mismatch' to a
    // 4xx so the storefront can re-render the order summary rather
    // than treating it as a server fault.
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { code: 'P0001', message: 'tax_amount_mismatch' },
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        tax_amount: 0,
      }),
    });
    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('Failed to create order');
    expect(body.details).toContain('tax_amount_mismatch');
  });

  it('maps tax_amount_must_be_zero_for_non_vat_merchant to 400', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: {
              code: 'P0001',
              message: 'tax_amount_must_be_zero_for_non_vat_merchant',
            },
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        tax_amount: 75,
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('logs known client order rejections as warnings instead of Vercel errors', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { code: 'P0001', message: 'shipping_quote_required' },
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        shipping_provider: 'gigl',
      }),
    });
    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toBe('shipping_quote_required');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'shipping_quote_required' }),
        message: 'Storefront order rejected by client-side validation',
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs unknown RPC failures as errors and returns 500', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: {
              code: 'P9999',
              message: 'database_connection_lost',
            },
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(baseOrderPayload),
    });
    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.details).toBe('database_connection_lost');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'database_connection_lost',
        }),
        message: 'Error creating order',
      })
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('forwards p_gift_wrapping_fee to the RPC', async () => {
    // Defense-in-depth contract test: the body's gift_wrapping_fee
    // must reach the SECURITY DEFINER RPC unchanged so the VAT
    // enforcement boundary (Δ-42) sees what the client actually
    // asked for. (Note: `tax_basis` is NOT in scope for forwarding
    // — Codex P1 round 6 made it server-controlled; see the
    // dedicated `forces p_tax_basis to "exclusive"` test below.)
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1500,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        gift_wrapping_fee: 500,
      }),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_gift_wrapping_fee: 500,
      })
    );
  });

  it('server-computes tax_amount and overrides the client value (Codex P1 round 6)', async () => {
    // Legacy `app/checkout/page.tsx` sends no tax_amount → Zod
    // default 0 → pre-fix the RPC's parity guard would RAISE
    // `tax_amount_mismatch` for VAT-registered merchants and break
    // checkout in production. The route recomputes tax server-side
    // via `computeAgenticOrderTax` (round 7: using the standard
    // scoped client + the `get_order_variant_overrides` SDF for
    // RLS bypass — no admin client in the Next.js layer).
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1075,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      // Per-table override for this test: the helper needs to see
      // a VAT-registered merchant + one taxable product. The route
      // also reads `merchants` separately for the order-create
      // merchant-existence check (uses `.single()`), which we keep
      // returning the default merchant fixture.
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                // Helper's read.
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                // Route's existence check.
                single: () =>
                  Promise.resolve({
                    data: { id: MERCHANT_ID, business_name: 'Test' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                  overrideTypes: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          name: 'Widget',
                          brand: null,
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        // Fall through for any other tables the route may touch.
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      // Mimic legacy checkout: no tax_amount in body.
      body: JSON.stringify({
        ...baseOrderPayload,
        tax_amount: undefined,
      }),
    });
    await POST(request);

    // ROUND(ROUND(1 * 1000, 2) * 7.5 / 100, 2) = 75
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({ p_tax_amount: 75 })
    );
  });

  it('turns an entitled bounded negotiated expected_total drift into a server-derived discount', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1042.75,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: 'pro',
                      vat_registration_status: 'registered',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                  overrideTypes: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          name: 'Widget',
                          brand: null,
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-1',
            quantity: 1,
            price: 980,
            name: 'Widget',
          },
        ],
        subtotal: 980,
        tax_amount: 73.5,
        expected_total: 1053.5,
        client_total: 1053.5,
      }),
    });
    await POST(request);

    // Per-line: catalog 1000, client 980 → reduction 20 (= 2% cap),
    // + 7.5% VAT on the reduction = 1.5 → discount 21.5.
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_discount_amount: 21.5,
        p_expected_total: 1053.5,
        p_tax_amount: 75,
      })
    );
  });

  it('preserves legacy negotiation entitlement fallback when plan_tier is missing', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1045,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: null,
                      slug: 'ogabassey',
                      vat_registration_status: 'registered',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                  overrideTypes: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          name: 'Widget',
                          brand: null,
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-1',
            quantity: 1,
            price: 980,
            name: 'Widget',
          },
        ],
        subtotal: 980,
        tax_amount: 73.5,
        expected_total: 1053.5,
        client_total: 1053.5,
      }),
    });
    await POST(request);

    // Per-line: catalog 1000, client 980 → reduction 20 (= 2% cap),
    // + 7.5% VAT on the reduction = 1.5 → discount 21.5.
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_discount_amount: 21.5,
        p_expected_total: 1053.5,
        p_tax_amount: 75,
      })
    );
  });

  it('does not derive a discount for merchants without price negotiation entitlement', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'order_total_mismatch',
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: 'starter',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                  overrideTypes: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          name: 'Widget',
                          brand: null,
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-1',
            quantity: 1,
            price: 980,
            name: 'Widget',
          },
        ],
        subtotal: 980,
        tax_amount: 73.5,
        expected_total: 1042.75,
        client_total: 1042.75,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toBe('order_total_mismatch');
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_discount_amount: 0,
      })
    );
  });

  it('does not apply legacy negotiation fallback when plan_tier is malformed', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'order_total_mismatch',
      },
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: 'starter_typo',
                      slug: 'ogabassey',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                  overrideTypes: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          name: 'Widget',
                          brand: null,
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-1',
            quantity: 1,
            price: 980,
            name: 'Widget',
          },
        ],
        subtotal: 980,
        tax_amount: 73.5,
        expected_total: 1042.75,
        client_total: 1042.75,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toBe('order_total_mismatch');
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        p_discount_amount: 0,
      })
    );
  });

  it('returns 500 when canonical subtotal preload fails during negotiated checkout', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'order_total_mismatch',
      },
    });

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: 'pro',
                      vat_registration_status: 'registered',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  // Tax helper's load (`.returns()`) succeeds; the
                  // per-line negotiation loader's load (`.overrideTypes()`)
                  // fails with a non-UUID db error → route returns 500.
                  returns: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 'p-1',
                          price: 1000,
                          vat_category_code: 'S',
                          vat_rate: 7.5,
                        },
                      ],
                      error: null,
                    }),
                  overrideTypes: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'db unavailable' },
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'p-1',
            quantity: 1,
            price: 980,
            name: 'Widget',
          },
        ],
        subtotal: 980,
        tax_amount: 73.5,
        expected_total: 1042.75,
        client_total: 1042.75,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe('Internal server error');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('maps a 22P02 UUID parse error from the tax helper to 400 INVALID_ITEM_ID (Codex P2 round 7)', async () => {
    // Item ids are only `z.string()` at the schema layer, so a
    // malformed product_id (e.g. a slug) reaches the helper and
    // surfaces as a Postgres 22P02 from `.in('id', productIds)`.
    // The previous RPC path mapped 22P02 as a client error via
    // `clientErrorCodes`; the new server-side tax recompute must
    // preserve that 4xx semantic instead of returning 500.
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: { id: MERCHANT_ID, business_name: 'Test' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: null,
                      error: {
                        code: '22P02',
                        message:
                          'invalid input syntax for type uuid: "not-a-uuid"',
                      },
                    }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'not-a-uuid',
            name: 'Widget',
            quantity: 1,
            price: 1000,
          },
        ],
      }),
    });
    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    // Round-7 follow-up: error shape unified with the RPC mapping
    // (`{ error: 'Failed to create order', details: 'invalid_items' }`).
    expect(body).toMatchObject({
      error: 'Failed to create order',
      details: 'invalid_items',
    });
  });

  it('maps a 22P02 UUID parse error from canonical subtotal lookup to 400 INVALID_ITEM_ID', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.from = ((table: string) => {
        if (table === 'merchants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { vat_registration_status: 'not_registered' },
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: {
                      id: MERCHANT_ID,
                      business_name: 'Test',
                      plan_tier: 'pro',
                      vat_registration_status: 'registered',
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  returns: () =>
                    Promise.resolve({
                      data: null,
                      error: {
                        code: '22P02',
                        message:
                          'invalid input syntax for type uuid: "not-a-uuid"',
                      },
                    }),
                  // Non-registered merchant → tax helper returns 0 without
                  // loading products, so the 22P02 surfaces from the
                  // per-line negotiation loader's `.overrideTypes()` read.
                  overrideTypes: () =>
                    Promise.resolve({
                      data: null,
                      error: {
                        code: '22P02',
                        message:
                          'invalid input syntax for type uuid: "not-a-uuid"',
                      },
                    }),
                }),
              }),
            }),
          };
        }

        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        };
      }) as typeof sb.from;
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        if (name === 'get_order_variant_overrides') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            product_id: 'not-a-uuid',
            quantity: 1,
            price: 970,
            name: 'Widget',
          },
        ],
        subtotal: 970,
        tax_amount: 0,
        expected_total: 970,
        client_total: 970,
      }),
    });

    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: 'Failed to create order',
      details: 'invalid_items',
    });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('forces p_tax_basis to "exclusive" regardless of client input (Codex P1 round 6)', async () => {
    // tax_basis is SERVER policy, not caller input. A buyer who
    // submits `tax_basis: 'inclusive'` on a VAT-registered merchant
    // would otherwise route through the RPC's inclusive branch,
    // which computes total = subtotal + shipping + gift - discount
    // (no VAT), undercharging by the VAT amount while the merchant
    // is still on the hook for FIRS. The API hardcodes 'exclusive'
    // until per-merchant pricing config exists.
    const rpcSpy = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
        },
      ],
      error: null,
    });
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation((() => {
      const sb = buildMockSupabase();
      sb.rpc = ((name: string, args: Record<string, unknown>) => {
        if (name === 'create_storefront_order') {
          return rpcSpy(args);
        }
        return Promise.resolve({ data: null, error: null });
      }) as typeof sb.rpc;
      return sb;
    }) as unknown as never);

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        tax_basis: 'inclusive',
      }),
    });
    await POST(request);

    expect(rpcSpy).toHaveBeenCalledWith(
      expect.objectContaining({ p_tax_basis: 'exclusive' })
    );
  });

  it('maps gift_wrapping_fee_negative to 400', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: {
              code: 'P0001',
              message: 'gift_wrapping_fee_negative',
            },
          },
        }) as unknown as never
    );

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        gift_wrapping_fee: 0,
      }),
    });
    const response = await POST(request);
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.details).toContain('gift_wrapping_fee_negative');
  });

  it('maps invalid_tax_basis to 400', async () => {
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () =>
        buildMockSupabase({
          create_storefront_order: {
            data: null,
            error: { code: 'P0001', message: 'invalid_tax_basis' },
          },
        }) as unknown as never
    );

    // Zod would normally catch this before the RPC call — this test
    // pins the route-level mapping in case a future schema change
    // widens the enum and the RPC becomes the only line of defense.
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(baseOrderPayload),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/orders — invoice payment method email attachment', () => {
  function createBackgroundSupabaseMock({
    accountError = null,
    orderItems = [
      {
        id: 'order-item-1',
        product_id: 'p-1',
        variant_id: null,
        variant_attributes: null,
        variant_name: null,
        name: 'Widget',
        quantity: 1,
        price: 1000,
        has_assurance: true,
        assurance_fee: 50,
        item_description: null,
        line_extension_amount: 1050,
        vat_category_code: 'S',
        vat_rate: 7.5,
        vat_amount: 0,
        sellers_item_id: null,
        unit_code: 'EA',
      },
    ],
    orderItemsError = null,
    orderItemsResponses,
    reminderError = null,
  }: {
    accountError?: unknown;
    orderItems?: unknown[];
    orderItemsError?: unknown;
    orderItemsResponses?: Array<{ data: unknown[]; error: unknown }>;
    reminderError?: unknown;
  } = {}) {
    const accountUpsert = vi.fn().mockResolvedValue({ error: accountError });
    const reminderInsert = vi.fn().mockResolvedValue({ error: reminderError });
    const orderItemReadResponses = orderItemsResponses ?? [
      {
        data: orderItems,
        error: orderItemsError,
      },
    ];
    const orderItemsOrder = vi.fn().mockImplementation(() => {
      const responseIndex = Math.min(
        orderItemsOrder.mock.calls.length - 1,
        orderItemReadResponses.length - 1
      );
      return Promise.resolve(orderItemReadResponses[responseIndex]);
    });
    const orderItemsQuery = {
      select: vi.fn(() => orderItemsQuery),
      eq: vi.fn(() => orderItemsQuery),
      order: orderItemsOrder,
    };
    const backgroundSupabase = {
      from: vi.fn((table: string) => {
        // Serves the route's stamped-currency read-back (service-role client).
        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { currency: 'NGN' }, error: null }),
          };
        }

        if (table === 'order_items') {
          return orderItemsQuery;
        }

        if (table === 'order_payment_accounts') {
          return { upsert: accountUpsert };
        }

        if (table === 'order_reminders') {
          return { insert: reminderInsert };
        }

        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    };

    return {
      accountUpsert,
      backgroundSupabase,
      orderItemsOrder,
      orderItemsQuery,
      reminderInsert,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    mockGeneratePaymentAccount.mockResolvedValue({
      success: true,
      data: {
        bank_name: 'Wema Bank',
        account_number: '1234567890',
        account_name: 'OgaBassey-Test',
        customer_code: 'CUS_mock',
      },
    });
    mockSendEmail.mockResolvedValue({ success: true });
    mockGenerateReceiptBlob.mockReturnValue(new Blob(['branded-invoice']));
    mockResolveReceiptLogoDataUri.mockResolvedValue(
      'data:image/png;base64,AA=='
    );
  });

  it('generates a branded PDF invoice and attaches it to the confirmation email when payment method is invoice', async () => {
    const supabase = buildMockSupabase();
    const { accountUpsert, backgroundSupabase, orderItemsOrder } =
      createBackgroundSupabaseMock({
        orderItemsResponses: [
          { data: [], error: null },
          {
            data: [
              {
                id: 'order-item-1',
                product_id: 'p-1',
                variant_id: null,
                variant_attributes: null,
                variant_name: null,
                name: 'Widget',
                quantity: 1,
                price: 1000,
                has_assurance: true,
                assurance_fee: 50,
                item_description: null,
                line_extension_amount: 1050,
                vat_category_code: 'S',
                vat_rate: 7.5,
                vat_amount: 0,
                sellers_item_id: null,
                unit_code: 'EA',
              },
            ],
            error: null,
          },
        ],
      });
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);

    supabase.from = vi.fn((_table: string) => {
      // Mock fallback single/maybeSingle queries
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: MERCHANT_ID,
            business_name: 'Test Merchant',
            country: 'NG',
            slug: 'test-merchant',
            support_email: 'support@example.com',
            email_sender_name: 'Test Store',
            email: 'merchant@example.com',
            vat_registration_status: 'registered',
            vat_rate: 7.5,
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: MERCHANT_ID,
            business_name: 'Test Merchant',
            country: 'NG',
            slug: 'test-merchant',
            support_email: 'support@example.com',
            email_sender_name: 'Test Store',
            email: 'merchant@example.com',
            vat_registration_status: 'registered',
            vat_rate: 7.5,
          },
          error: null,
        }),
        in: vi.fn().mockReturnThis(),
        returns: vi.fn().mockResolvedValue({ data: [], error: null }),
        overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
        // biome-ignore lint/suspicious/noThenProperty: simulated thenable mock
        then: (resolve: any) => Promise.resolve().then(resolve),
      };
    }) as any;

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            has_assurance: true,
          },
        ],
        payment_method: 'invoice',
        shipping_address: {
          ...baseOrderPayload.shipping_address,
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    // Wait for the async after() block to settle (yield to the event loop)
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });
    await vi.waitFor(() => expect(mockNotifyNewInvoice).toHaveBeenCalled(), {
      timeout: 1000,
    });
    expect(mockNotifyNewInvoice).toHaveBeenCalledWith(
      MERCHANT_ID,
      'order-id',
      'ORD-123',
      'Test Customer',
      1000,
      {
        currency: 'NGN',
        preferenceClient: supabase,
      }
    );
    expect(mockNotifyNewOrder).not.toHaveBeenCalled();
    expect(orderItemsOrder).toHaveBeenCalledTimes(2);

    // Assert sendEmail was called with the branded invoice attachment. The
    // checkout payload does not currently collect a buyer Peppol endpoint, so
    // XML/compliance text is intentionally withheld for this fixture.
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: expect.stringContaining('Invoice Generated'),
        attachments: [
          expect.objectContaining({
            name: expect.stringMatching(/^invoice-ORD-.*\.pdf$/),
            mime_type: 'application/pdf',
            content: expect.any(String), // base64 string
          }),
        ],
      })
    );

    // Assert DVA generation was automatically triggered
    expect(mockGeneratePaymentAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'customer@example.com',
        firstName: 'Test',
        lastName: 'Customer',
        phone: '08012345678',
        orderId: 'order-id',
      })
    );
    expect(mockGenerateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        order_number: 'ORD-123',
        payment_status: 'unpaid',
        virtual_account: expect.objectContaining({
          account_number: '1234567890',
          bank_name: 'Wema Bank',
        }),
      }),
      expect.objectContaining({
        business_name: 'Test Merchant',
        vat_registration_status: 'registered',
      }),
      expect.objectContaining({
        complianceNote: undefined,
        documentKind: 'invoice',
        invoiceNotes: undefined,
        logoDataUri: 'data:image/png;base64,AA==',
        paymentTerms: undefined,
        taxSubtotals: expect.any(Array),
      })
    );
    const lastReceiptBlobCall = mockGenerateReceiptBlob.mock.calls.at(
      -1
    ) as unknown as [
      unknown,
      unknown,
      {
        documentDate: Date;
        dueDate: Date;
      },
    ];
    const pdfOptions = lastReceiptBlobCall[2];
    const receiptOrder = lastReceiptBlobCall[0] as {
      shipping_address?: { country?: string; postal_code?: string } | null;
      items?: Array<{
        description?: string;
        line_extension_amount?: number;
      }>;
    };
    expect(receiptOrder.shipping_address?.country).toBe('CA');
    expect(receiptOrder.shipping_address?.postal_code).toBe('M5V 3L9');
    expect(receiptOrder.items?.[0]).toMatchObject({
      description: expect.stringContaining('Includes device assurance fee'),
      line_extension_amount: 1050,
    });
    expect(pdfOptions.documentDate).toBeInstanceOf(Date);
    expect(pdfOptions.dueDate).toBeInstanceOf(Date);
    expect(pdfOptions.dueDate.getTime()).toBe(
      pdfOptions.documentDate.getTime() + 14 * 24 * 60 * 60 * 1000
    );

    // Assert the auto-generated DVA was persisted with the shared upsert/expiry contract.
    expect(backgroundSupabase.from).toHaveBeenCalledWith(
      'order_payment_accounts'
    );
    expect(accountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'order-id',
        account_number: '1234567890',
        bank_name: 'Wema Bank',
        account_name: 'OgaBassey-Test',
        provider: 'paystack',
        expires_at: expect.any(String),
      }),
      { onConflict: 'order_id,provider' }
    );
    expect(
      Date.parse(
        (accountUpsert.mock.calls[0]?.[0] as { expires_at: string }).expires_at
      )
    ).toBe(pdfOptions.dueDate.getTime());
    expect(backgroundSupabase.from).toHaveBeenCalledWith('order_reminders');
    expect(supabase.from).not.toHaveBeenCalledWith('order_payment_accounts');
  });

  it('still sends the base invoice email when attachment generation cannot load persisted items', async () => {
    const supabase = buildMockSupabase();
    const { backgroundSupabase } = createBackgroundSupabaseMock({
      orderItems: [],
      orderItemsError: { message: 'order_items unavailable' },
    });
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);

    supabase.from = vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      in: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      // biome-ignore lint/suspicious/noThenProperty: simulated thenable mock
      then: (resolve: any) => Promise.resolve().then(resolve),
    })) as any;

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        payment_method: 'invoice',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });
    expect(mockGenerateReceiptBlob).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: expect.stringContaining('Invoice Generated'),
        attachments: undefined,
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to generate invoice PDF or log initial reminder',
        orderId: 'order-id',
      })
    );
  });

  it('renders invoice attachments from persisted canonical order items', async () => {
    const supabase = buildMockSupabase();
    const { backgroundSupabase } = createBackgroundSupabaseMock({
      orderItems: [
        {
          id: 'order-item-1',
          product_id: 'p-1',
          variant_id: null,
          variant_attributes: null,
          variant_name: 'Matte Black',
          name: 'Canonical Widget',
          quantity: 1,
          price: 1250,
          has_assurance: false,
          assurance_fee: 0,
          item_description: null,
          line_extension_amount: 1250,
          vat_category_code: 'S',
          vat_rate: 7.5,
          vat_amount: 0,
          sellers_item_id: 'SKU-CANONICAL',
          unit_code: 'EA',
        },
      ],
    });
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);

    supabase.from = vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      in: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      // biome-ignore lint/suspicious/noThenProperty: simulated thenable mock
      then: (resolve: any) => Promise.resolve().then(resolve),
    })) as any;

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            name: 'Client Supplied Widget',
            price: 999,
          },
        ],
        payment_method: 'invoice',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });

    expect(mockGenerateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            product_name: 'Canonical Widget',
            variant_name: 'Matte Black',
            price: 1250,
            line_extension_amount: 1250,
            sellers_item_id: 'SKU-CANONICAL',
          }),
        ],
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('passes persisted item condition without fabricating a raw variant label when variant_name is empty', async () => {
    const supabase = buildMockSupabase();
    const { backgroundSupabase } = createBackgroundSupabaseMock({
      orderItems: [
        {
          id: 'order-item-1',
          product_id: 'p-1',
          variant_id: null,
          variant_attributes: null,
          variant_name: null,
          condition: 'used',
          name: 'Samsung Galaxy S22 Ultra',
          quantity: 1,
          price: 750000,
          has_assurance: false,
          assurance_fee: 0,
          item_description: null,
          line_extension_amount: 750000,
          vat_category_code: 'S',
          vat_rate: 7.5,
          vat_amount: 0,
          sellers_item_id: null,
          unit_code: 'EA',
        },
      ],
    });
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        items: [
          {
            ...baseOrderPayload.items[0],
            condition: 'used',
            name: 'Samsung Galaxy S22 Ultra',
          },
        ],
        payment_method: 'invoice',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });

    expect(mockGenerateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            condition: 'used',
            product_name: 'Samsung Galaxy S22 Ultra',
            variant_name: undefined,
          }),
        ],
      }),
      expect.any(Object),
      expect.any(Object)
    );
    const lastReceiptBlobCall = mockGenerateReceiptBlob.mock.calls.at(
      -1
    ) as unknown as
      | [{ items?: Array<{ description?: unknown }> }, unknown, unknown]
      | undefined;
    const receiptOrder = lastReceiptBlobCall?.[0];
    expect(receiptOrder?.items?.[0]?.description).toBeUndefined();
  });

  it('sends the invoice email with fallback branding when logo resolution fails', async () => {
    const supabase = buildMockSupabase();
    const { backgroundSupabase } = createBackgroundSupabaseMock();
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);
    mockResolveReceiptLogoDataUri.mockRejectedValueOnce(
      new Error('logo fetch failed')
    );

    supabase.from = vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      in: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      // biome-ignore lint/suspicious/noThenProperty: simulated thenable mock
      then: (resolve: any) => Promise.resolve().then(resolve),
    })) as any;

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        payment_method: 'invoice',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });

    expect(mockGenerateReceiptBlob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        documentKind: 'invoice',
        logoDataUri: null,
      })
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ mime_type: 'application/pdf' }),
        ]),
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve invoice logo; using fallback PDF branding',
        orderId: 'order-id',
      })
    );
  });

  it('still sends the invoice email when background DVA persistence fails', async () => {
    const supabase = buildMockSupabase();
    const { accountUpsert, backgroundSupabase, reminderInsert } =
      createBackgroundSupabaseMock({
        accountError: { message: 'insert failed' },
        reminderError: { message: 'reminder failed' },
      });
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);

    supabase.from = vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      in: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      // biome-ignore lint/suspicious/noThenProperty: simulated thenable mock
      then: (resolve: any) => Promise.resolve().then(resolve),
    })) as any;

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        payment_method: 'invoice',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });

    expect(mockGeneratePaymentAccount).toHaveBeenCalled();
    expect(accountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'order-id',
        account_number: '1234567890',
        expires_at: expect.any(String),
      }),
      { onConflict: 'order_id,provider' }
    );
    expect(reminderInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'order-id',
        channel: 'email',
      })
    );
    expect(backgroundSupabase.from).toHaveBeenCalledWith(
      'order_payment_accounts'
    );
    expect(backgroundSupabase.from).toHaveBeenCalledWith('order_reminders');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ mime_type: 'application/pdf' }),
        ]),
      })
    );
    expect(mockGenerateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        virtual_account: null,
      }),
      expect.any(Object),
      expect.any(Object)
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to store auto-generated invoice DVA',
        orderId: 'order-id',
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to store initial invoice reminder',
        orderId: 'order-id',
      })
    );
  });

  it('counts wallet credit as paid in generated invoice emails', async () => {
    const supabase = buildMockSupabase({
      redeem_wallet_for_order: {
        data: [
          {
            success: true,
            redeemed_amount: 300,
            new_balance: 700,
            transaction_id: 'wallet-tx-1',
          },
        ],
        error: null,
      },
    });
    const { backgroundSupabase } = createBackgroundSupabaseMock();
    mockCreateAdminClient.mockReturnValue(backgroundSupabase);

    supabase.from = vi.fn((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: MERCHANT_ID,
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
          vat_registration_status: 'registered',
          vat_rate: 7.5,
        },
        error: null,
      }),
      in: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      // biome-ignore lint/suspicious/noThenProperty: simulated thenable mock
      then: (resolve: any) => Promise.resolve().then(resolve),
    })) as any;

    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: null,
      supabase: supabase as unknown as never,
    });

    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        payment_method: 'invoice',
        use_wallet_credit: true,
        wallet_amount: 300,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), {
      timeout: 1000,
    });

    expect(mockGenerateReceiptBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_paid: 300,
        balance: 700,
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });
});

describe('POST /api/orders — discount code', () => {
  const DISCOUNT_CODE_ROW = {
    id: '33333333-3333-4333-8333-333333333333',
    code: 'SAVE10',
    discount_type: 'percentage',
    discount_value: 10,
    starts_at: null,
    expires_at: null,
    usage_limit: null,
    usage_count: 0,
    minimum_purchase_amount: null,
    maximum_discount_amount: null,
    description: null,
    applies_to: 'all',
    product_ids: [],
    category_ids: [],
    usage_limit_per_customer: 1,
  };
  const orderRowWithDiscount = {
    ...baseOrderRow,
    total: 900,
    subtotal: 1000,
    discount_amount: 100,
  };
  const PRODUCT_ROWS = [{ id: 'p-1', price: 1000 }];

  async function setupDiscount(
    overrides: RpcOverrides,
    opts: { productRows?: Array<{ id: string; price: number }> } = {}
  ) {
    vi.clearAllMocks();
    primeAdminOrderCurrencyRead();
    const supabase = buildMockSupabase(overrides, opts);
    const supabaseMod = await import('@/lib/supabase/server');
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(AUTH_USER_ID),
      error: null,
      supabase: supabase as unknown as never,
    });
    return supabase;
  }

  function discountRequest(extra: Record<string, unknown> = {}) {
    return new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({ ...baseOrderPayload, ...extra }),
    });
  }

  it('dispatches create_storefront_order_with_discount_code with the canonical amount', async () => {
    const supabase = await setupDiscount(
      {
        get_storefront_discount_code: {
          data: [DISCOUNT_CODE_ROW],
          error: null,
        },
        create_storefront_order_with_discount_code: {
          data: [orderRowWithDiscount],
          error: null,
        },
      },
      { productRows: PRODUCT_ROWS }
    );

    const response = await POST(discountRequest({ discount_code: 'SAVE10' }));

    expect(response.status).toBeLessThan(400);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_discount_code',
      expect.objectContaining({
        p_discount_code_id: DISCOUNT_CODE_ROW.id,
        p_discount_amount: 100,
      })
    );
  });

  it('still rejects a raw non-zero discount_amount when no code is sent', async () => {
    const supabase = await setupDiscount({});
    const response = await POST(discountRequest({ discount_amount: 500 }));
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe(
      'discount_amount_not_supported'
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 discount_code_invalid for an unknown code', async () => {
    const supabase = await setupDiscount({
      get_storefront_discount_code: { data: [], error: null },
    });
    const response = await POST(discountRequest({ discount_code: 'NOPE' }));
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe('discount_code_invalid');
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order_with_discount_code',
      expect.anything()
    );
  });

  it('rejects a discount code combined with savings', async () => {
    await setupDiscount(
      {
        get_storefront_discount_code: {
          data: [DISCOUNT_CODE_ROW],
          error: null,
        },
      },
      { productRows: PRODUCT_ROWS }
    );
    const response = await POST(
      discountRequest({
        discount_code: 'SAVE10',
        use_savings_credit: true,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        savings_amount: 100,
      })
    );
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe(
      'DISCOUNT_CODE_SAVINGS_COMBINATION_UNSUPPORTED'
    );
  });

  it('maps usage_limit_reached to 409', async () => {
    await setupDiscount(
      {
        get_storefront_discount_code: {
          data: [DISCOUNT_CODE_ROW],
          error: null,
        },
        create_storefront_order_with_discount_code: {
          data: null,
          error: { message: 'usage_limit_reached' },
        },
      },
      { productRows: PRODUCT_ROWS }
    );
    const response = await POST(discountRequest({ discount_code: 'SAVE10' }));
    expect(response.status).toBe(409);
    expect((await readJson(response)).code).toBe('usage_limit_reached');
  });

  it('maps per_customer_limit_reached to 409', async () => {
    await setupDiscount(
      {
        get_storefront_discount_code: {
          data: [DISCOUNT_CODE_ROW],
          error: null,
        },
        create_storefront_order_with_discount_code: {
          data: null,
          error: { message: 'per_customer_limit_reached' },
        },
      },
      { productRows: PRODUCT_ROWS }
    );
    const response = await POST(discountRequest({ discount_code: 'SAVE10' }));
    expect(response.status).toBe(409);
    expect((await readJson(response)).code).toBe('per_customer_limit_reached');
  });

  it('maps discount_amount_mismatch to 400', async () => {
    await setupDiscount(
      {
        get_storefront_discount_code: {
          data: [DISCOUNT_CODE_ROW],
          error: null,
        },
        create_storefront_order_with_discount_code: {
          data: null,
          error: { message: 'discount_amount_mismatch' },
        },
      },
      { productRows: PRODUCT_ROWS }
    );
    const response = await POST(discountRequest({ discount_code: 'SAVE10' }));
    expect(response.status).toBe(400);
    expect((await readJson(response)).details).toBe('discount_amount_mismatch');
  });

  it('replays (does not reject) a deactivated code via the wrapper', async () => {
    const supabase = await setupDiscount(
      {
        get_storefront_discount_code: {
          data: [{ ...DISCOUNT_CODE_ROW, is_active: false }],
          error: null,
        },
        create_storefront_order_with_discount_code: {
          data: [{ ...orderRowWithDiscount, idempotency_replayed: true }],
          error: null,
        },
      },
      { productRows: PRODUCT_ROWS }
    );
    const response = await POST(discountRequest({ discount_code: 'SAVE10' }));
    expect(response.status).toBeLessThan(400);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_discount_code',
      expect.any(Object)
    );
  });
});

describe('POST /api/orders — merchant shipping rate enforcement', () => {
  const LAGOS_ZONE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ROW_ZONE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const LAGOS_RATE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  // Raw snake_case payload, exactly as the get_storefront_shipping_rates RPC
  // returns it (verifyOrderShippingRate parses it through the Zod schema).
  function shippingRatesRpcPayload(
    rateOverrides: Record<string, unknown> = {}
  ) {
    return {
      zones: [
        {
          id: LAGOS_ZONE_ID,
          name: 'Lagos',
          is_rest_of_world: false,
          active: true,
        },
        {
          id: ROW_ZONE_ID,
          name: 'Everywhere else',
          is_rest_of_world: true,
          active: true,
        },
      ],
      locations: [
        {
          zone_id: LAGOS_ZONE_ID,
          country_code: 'NG',
          subdivision_code: 'NG-LA',
        },
      ],
      rates: [
        {
          id: LAGOS_RATE_ID,
          zone_id: LAGOS_ZONE_ID,
          name: 'Lagos Standard',
          kind: 'ship',
          currency: 'NGN',
          base_amount: 1500,
          condition_type: 'always',
          min_subtotal: null,
          max_subtotal: null,
          free_over_amount: null,
          delivery_min_days: 1,
          delivery_max_days: 3,
          pickup_address: null,
          sort_order: 0,
          active: true,
          ...rateOverrides,
        },
      ],
    };
  }

  // Extends primeAdminOrderCurrencyRead's shape with the rates RPC and the
  // post-create shipping_provider stamp (update().eq().eq()).
  function primeAdminShippingRateClient(
    ratesPayload: unknown,
    options: { ratesError?: unknown } = {}
  ) {
    const updateEqSecond = vi.fn().mockResolvedValue({ error: null });
    const updateEqFirst = vi.fn(() => ({ eq: updateEqSecond }));
    const update = vi.fn(() => ({ eq: updateEqFirst }));
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? {
              data: options.ratesError ? null : ratesPayload,
              error: options.ratesError ?? null,
            }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { currency: 'NGN' },
          error: null,
        }),
        update,
      })),
      rpc,
    } as never);
    return { rpc, update, updateEqFirst, updateEqSecond };
  }

  async function primeStorefrontClient() {
    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {},
      {
        // Catalog price matches the client line price (1000), so the
        // canonical subtotal for tier/free-over checks is 1000.
        productRows: [
          { id: 'p-1', name: 'Widget', price: 1000, slug: 'widget' },
        ],
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );
    return supabase;
  }

  function rateOrderRequest(overrides: Record<string, unknown> = {}) {
    return new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...baseOrderPayload,
        shipping_rate_id: LAGOS_RATE_ID,
        shipping_fee: 1500,
        ...overrides,
      }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  it('accepts a valid merchant rate, passes the server-computed fee with nulled provider/quote id, and stamps the provider', async () => {
    // Arrange
    const admin = primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act — baseOrderPayload ships to state 'Lagos' with no country; the
    // merchant fixture country (NG) supplies the domestic fallback.
    const response = await POST(rateOrderRequest());

    // Assert
    expect(response.status).toBe(201);
    expect(admin.rpc).toHaveBeenCalledWith('get_storefront_shipping_rates', {
      p_merchant_id: MERCHANT_ID,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_shipping_fee: 1500,
        p_shipping_provider: null,
        p_selected_quote_id: null,
      })
    );
    expect(admin.update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
    });
    expect(admin.updateEqFirst).toHaveBeenCalledWith('id', 'order-id');
    expect(admin.updateEqSecond).toHaveBeenCalledWith(
      'merchant_id',
      MERCHANT_ID
    );
  });

  it('stamps MERCHANT_PICKUP when the selected rate is a pickup rate', async () => {
    // Arrange — same Lagos rate, but configured as a local pickup option with
    // no configured collection address (pickup_address: null).
    const admin = primeAdminShippingRateClient(
      shippingRatesRpcPayload({ kind: 'pickup' })
    );
    await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest());

    // Assert — fulfillment must see pickup, not a door delivery. The pickup
    // snapshot is written (null here since the rate carries no address).
    expect(response.status).toBe(201);
    expect(admin.update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT_PICKUP',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
      shipping_pickup_details: null,
    });
  });

  it('snapshots the pickup collection address into shipping_pickup_details', async () => {
    // Arrange — a pickup rate carrying a full collection address/instructions.
    // Raw snake_case `country_code` is normalized to `countryCode` by the
    // storefront rates schema before it reaches the stamp.
    const admin = primeAdminShippingRateClient(
      shippingRatesRpcPayload({
        kind: 'pickup',
        pickup_address: {
          label: 'Ikeja Pickup Hub',
          address: '5 Allen Avenue',
          city: 'Ikeja',
          state: 'Lagos',
          country_code: 'NG',
          instructions: 'Ask for the front desk',
        },
      })
    );
    await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest());

    // Assert — the durable collection snapshot is persisted alongside the
    // provider + rate-name so the order retains it even if the rate is later
    // edited or deleted.
    expect(response.status).toBe(201);
    expect(admin.update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT_PICKUP',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
      shipping_pickup_details: {
        label: 'Ikeja Pickup Hub',
        address: '5 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        countryCode: 'NG',
        instructions: 'Ask for the front desk',
      },
    });
  });

  it('rejects a rate stamped in a stale currency with 400 SHIPPING_RATE_INVALID', async () => {
    // Arrange — the merchant fixture resolves to NGN, but the stored rate is
    // priced in USD (the store currency changed without re-saving rates).
    const admin = primeAdminShippingRateClient(
      shippingRatesRpcPayload({ currency: 'USD' })
    );
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest());

    // Assert
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_RATE_INVALID',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('rejects a tampered shipping_fee with 400 SHIPPING_FEE_MISMATCH before the order RPC runs', async () => {
    // Arrange
    const admin = primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act — client claims 100 for a rate the server computes at 1500.
    const response = await POST(rateOrderRequest({ shipping_fee: 100 }));

    // Assert
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_FEE_MISMATCH',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('rejects a rate from a zone that does not win the destination match', async () => {
    // Arrange — the Lagos-zone rate is selected but the address resolves to
    // Abuja (NG-FC), where the rest-of-world zone wins.
    primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(
      rateOrderRequest({
        shipping_address: {
          address: '1 Aso Villa Road',
          city: 'Abuja',
          state: 'FCT - Abuja',
        },
      })
    );

    // Assert
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_RATE_ZONE_MISMATCH',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('rejects an unknown shipping_rate_id with 400 SHIPPING_RATE_INVALID', async () => {
    // Arrange
    primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(
      rateOrderRequest({
        shipping_rate_id: '99999999-9999-4999-8999-999999999999',
      })
    );

    // Assert
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_RATE_INVALID',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('maps a rate-config load failure to 500 SHIPPING_RATE_LOOKUP_FAILED (not a 400 invalid-rate)', async () => {
    // Arrange — the storefront rates RPC errors (schema-cache/DB outage). The
    // verifier must fail LOUD: a transient load failure is a server error, not
    // a customer-correctable invalid rate, and the order RPC must not run.
    const admin = primeAdminShippingRateClient(shippingRatesRpcPayload(), {
      ratesError: { message: 'schema cache reload required', code: 'PGRST002' },
    });
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest());

    // Assert
    expect(response.status).toBe(500);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_RATE_LOOKUP_FAILED',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('still rejects a genuinely-empty rate set with 400 SHIPPING_RATE_INVALID (distinct from the load-failure 500)', async () => {
    // Arrange — the RPC SUCCEEDS but the merchant has no rates configured, so
    // the selected rate id is simply absent. That stays a customer-facing 400,
    // proving the load-failure 500 above is not just "empty result".
    const admin = primeAdminShippingRateClient({
      ...shippingRatesRpcPayload(),
      rates: [],
    });
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest());

    // Assert
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_RATE_INVALID',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('accepts fee 0 when the canonical subtotal crosses the free-over threshold', async () => {
    // Arrange — subtotal 1000 >= free_over_amount 500 → server fee 0.
    primeAdminShippingRateClient(
      shippingRatesRpcPayload({ free_over_amount: 500 })
    );
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest({ shipping_fee: 0 }));

    // Assert
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_shipping_fee: 0,
        p_shipping_provider: null,
        p_selected_quote_id: null,
      })
    );
  });

  it('leaves orders without shipping_rate_id on the existing path (no rates RPC, no stamp)', async () => {
    // Arrange
    const admin = primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(baseOrderPayload),
      })
    );

    // Assert
    expect(response.status).toBe(201);
    expect(admin.rpc).not.toHaveBeenCalledWith(
      'get_storefront_shipping_rates',
      expect.anything()
    );
    expect(admin.update).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_shipping_fee: 0 })
    );
  });

  it('replays the original order on an idempotent retry without re-verifying a since-changed merchant rate', async () => {
    // Arrange — the first attempt already created the order; the merchant then
    // deleted/repriced the selected rate, so the rates RPC now returns an
    // empty set (fresh verification WOULD fail closed). F1: the pre-existing
    // order for (merchant + idempotency key) must replay instead of 400ing.
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    }));
    const ratesRpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? { data: { zones: [], locations: [], rates: [] }, error: null }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // Pre-check finds the original order (same merchant + key); the
        // currency read-back reads the same row back. The original order was
        // fully stamped on the first attempt (shipping_provider present), so
        // the replay re-stamp path is not entered and the rate config is not
        // reloaded.
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'existing-order-id',
            currency: 'NGN',
            shipping_provider: 'MERCHANT',
          },
          error: null,
        }),
        update,
      })),
      rpc: ratesRpc,
    } as never);

    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {
        create_storefront_order: {
          data: [{ ...baseOrderRow, idempotency_replayed: true }],
          error: null,
        },
      },
      {
        productRows: [
          { id: 'p-1', name: 'Widget', price: 1000, slug: 'widget' },
        ],
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act — retry with the same idempotency key.
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'rate-retry-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_rate_id: LAGOS_RATE_ID,
          shipping_fee: 1500,
        }),
      })
    );

    // Assert — replayed (200), not a stale-rate 400; verification never ran
    // (no rates RPC), and the provider stamp is skipped on replay.
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.idempotency).toEqual({ replayed: true });
    expect(ratesRpc).not.toHaveBeenCalledWith(
      'get_storefront_shipping_rates',
      expect.anything()
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.any(Object)
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('re-stamps a merchant-rate replay whose original order is missing fulfillment metadata', async () => {
    // Arrange — R9-5: the FIRST attempt's create RPC succeeded but its
    // post-create provider stamp failed, so the persisted order has a null
    // shipping_provider. A retry with the same Idempotency-Key replays that
    // order; the route must best-effort backfill the missing fulfillment
    // metadata (provider + rate name) from the still-loadable rate config.
    const updateEqSecond = vi.fn().mockResolvedValue({ error: null });
    const updateEqFirst = vi.fn(() => ({ eq: updateEqSecond }));
    const update = vi.fn(() => ({ eq: updateEqFirst }));
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? { data: shippingRatesRpcPayload(), error: null }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // Pre-check finds the original order; the read-back returns it with a
        // NULL shipping_provider — the first attempt's stamp never landed.
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'existing-order-id',
            currency: 'NGN',
            shipping_provider: null,
          },
          error: null,
        }),
        update,
      })),
      rpc,
    } as never);

    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {
        create_storefront_order: {
          data: [{ ...baseOrderRow, idempotency_replayed: true }],
          error: null,
        },
      },
      {
        productRows: [
          { id: 'p-1', name: 'Widget', price: 1000, slug: 'widget' },
        ],
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act — retry with the same idempotency key.
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'rate-restamp-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_rate_id: LAGOS_RATE_ID,
          shipping_fee: 1500,
        }),
      })
    );

    // Assert — replayed (200), and the absent provider + rate name were
    // backfilled onto the existing order (id 'order-id' from the RPC result).
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.idempotency).toEqual({ replayed: true });
    expect(rpc).toHaveBeenCalledWith('get_storefront_shipping_rates', {
      p_merchant_id: MERCHANT_ID,
    });
    expect(update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
    });
    expect(updateEqFirst).toHaveBeenCalledWith('id', 'order-id');
    expect(updateEqSecond).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
  });

  it('does not re-stamp a merchant-rate replay whose order already has fulfillment metadata', async () => {
    // Arrange — R9-5: the replayed order already carries a shipping_provider,
    // so the route must NOT re-stamp and must NOT reload the rate config.
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    }));
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? { data: shippingRatesRpcPayload(), error: null }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'existing-order-id',
            currency: 'NGN',
            shipping_provider: 'MERCHANT',
          },
          error: null,
        }),
        update,
      })),
      rpc,
    } as never);

    const supabaseMod = await import('@/lib/supabase/server');
    const supabase = buildMockSupabase(
      {
        create_storefront_order: {
          data: [{ ...baseOrderRow, idempotency_replayed: true }],
          error: null,
        },
      },
      {
        productRows: [
          { id: 'p-1', name: 'Widget', price: 1000, slug: 'widget' },
        ],
      }
    );
    vi.mocked(supabaseMod.createClient).mockImplementation(
      () => supabase as unknown as never
    );

    // Act — retry with the same idempotency key.
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'rate-restamp-key-2' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_rate_id: LAGOS_RATE_ID,
          shipping_fee: 1500,
        }),
      })
    );

    // Assert — replayed with no re-stamp and no rate reload.
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith(
      'get_storefront_shipping_rates',
      expect.anything()
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('still fails closed on a first-time invalid rate even when an idempotency key is present', async () => {
    // Arrange — an idempotency key is present but NO prior order exists for it
    // (maybeSingle → null), so this is a genuine first attempt. F1 must NOT
    // weaken verification here: an unknown/invalid rate still 400s.
    const ratesRpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? { data: shippingRatesRpcPayload(), error: null }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn(),
      })),
      rpc: ratesRpc,
    } as never);
    const supabase = await primeStorefrontClient();

    // Act — first attempt selects a rate id the merchant does not own.
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'rate-first-key-1' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_rate_id: '99999999-9999-4999-8999-999999999999',
          shipping_fee: 1500,
        }),
      })
    );

    // Assert — verification ran (rates RPC called) and rejected; no order.
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_RATE_INVALID',
    });
    expect(ratesRpc).toHaveBeenCalledWith('get_storefront_shipping_rates', {
      p_merchant_id: MERCHANT_ID,
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('sends a different idempotency request hash when two same-priced merchant rates reuse one Idempotency-Key', async () => {
    // The shopper reuses the same Idempotency-Key after switching between two
    // same-priced merchant rates (e.g. two same-fee pickup locations at the same
    // address). Merchant-rate orders null shipping_provider + selected_quote_id,
    // so the rate id is the only distinguishing field. The route must reach the
    // RPC with a DIFFERENT p_checkout_request_hash for the two rate ids —
    // otherwise the RPC recomputes the same hash and REPLAYS the original order
    // instead of returning checkout_idempotency_conflict, fulfilling the shopper
    // for the previously-selected rate.
    const RATE_B_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const IDEMPOTENCY_KEY = 'switch-rate-same-key';

    function extractCreateHash(rpc: { mock: { calls: unknown[][] } }) {
      const call = rpc.mock.calls.find(
        ([name]) => name === 'create_storefront_order'
      );
      return (call?.[1] as { p_checkout_request_hash?: string } | undefined)
        ?.p_checkout_request_hash;
    }

    function attempt(rateId: string) {
      return POST(
        new NextRequest('http://localhost/api/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
          body: JSON.stringify({
            ...baseOrderPayload,
            shipping_rate_id: rateId,
            shipping_fee: 1500,
          }),
        })
      );
    }

    // Attempt A — the originally-selected rate.
    primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabaseA = await primeStorefrontClient();
    const responseA = await attempt(LAGOS_RATE_ID);
    expect(responseA.status).toBeLessThan(400);
    const hashA = extractCreateHash(
      supabaseA.rpc as unknown as { mock: { calls: unknown[][] } }
    );

    // Attempt B — same key, same fee/address, a DIFFERENT same-priced rate.
    primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabaseB = await primeStorefrontClient();
    const responseB = await attempt(RATE_B_ID);
    expect(responseB.status).toBeLessThan(400);
    const hashB = extractCreateHash(
      supabaseB.rpc as unknown as { mock: { calls: unknown[][] } }
    );

    expect(hashA).toBeDefined();
    expect(hashB).toBeDefined();
    expect(hashA).not.toBe(hashB);
  });

  it('bugfix: keeps merchant-rate idempotency hash on pre-repair state while persisting Lagos', async () => {
    // Arrange — postal-code state that this PR repairs to Lagos for zone
    // verification/persistence. Pre-deploy orders hashed the original
    // "100001"; hashing the repaired state would break Idempotency-Key retries.
    const malformedShippingAddress = {
      address: '2 Olaide Tomori Street, Ikeja, Lagos 100001, Nigeria',
      city: 'Ikeja',
      state: '100001',
      country: 'Nigeria',
      countryCode: 'NG',
    };
    primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act
    const response = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'malformed-state-retry-key' },
        body: JSON.stringify({
          ...baseOrderPayload,
          shipping_address: malformedShippingAddress,
          shipping_rate_id: LAGOS_RATE_ID,
          shipping_fee: 1500,
        }),
      })
    );
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ order: { id: 'order-id' } });
    const createCall = (
      supabase.rpc as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.find(([name]) => name === 'create_storefront_order');
    const rpcParams = createCall?.[1] as
      | {
          p_checkout_request_hash?: string;
          p_shipping_address?: { state?: string };
        }
      | undefined;

    expect(rpcParams?.p_shipping_address?.state).toBe('Lagos');
    const normalizedHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload({
        ...baseOrderPayload,
        shipping_address: { ...malformedShippingAddress, state: 'Lagos' },
        shipping_fee: 1500,
        shipping_provider: null,
        selected_quote_id: null,
        shipping_rate_id: LAGOS_RATE_ID,
        discount_amount: 0,
        discount_code: null,
        gift_wrapping_fee: 0,
      })
    );
    expect(rpcParams?.p_checkout_request_hash).toBeDefined();
    expect(rpcParams?.p_checkout_request_hash).not.toBe(normalizedHash);
    expect(rpcParams?.p_checkout_request_hash).toBe(
      hashOrderIdempotencyPayload(
        buildOrderIdempotencyPayload({
          ...baseOrderPayload,
          shipping_address: malformedShippingAddress,
          shipping_fee: 1500,
          shipping_provider: null,
          selected_quote_id: null,
          shipping_rate_id: LAGOS_RATE_ID,
          discount_amount: 0,
          discount_code: null,
          gift_wrapping_fee: 0,
        })
      )
    );
  });

  const ROW_RATE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  // A ship/pickup rate on the rest-of-world (country-level) zone. It verifies
  // for any NG destination via the merchant-country fallback even when the
  // caller sends NO shipping_address — the exact R6-4 unfulfillable case.
  function rowRateRpcPayload(rateOverrides: Record<string, unknown> = {}) {
    return {
      zones: [
        {
          id: LAGOS_ZONE_ID,
          name: 'Lagos',
          is_rest_of_world: false,
          active: true,
        },
        {
          id: ROW_ZONE_ID,
          name: 'Everywhere else',
          is_rest_of_world: true,
          active: true,
        },
      ],
      locations: [
        {
          zone_id: LAGOS_ZONE_ID,
          country_code: 'NG',
          subdivision_code: 'NG-LA',
        },
      ],
      rates: [
        {
          id: ROW_RATE_ID,
          zone_id: ROW_ZONE_ID,
          name: 'Nationwide Delivery',
          kind: 'ship',
          currency: 'NGN',
          base_amount: 1500,
          condition_type: 'always',
          min_subtotal: null,
          max_subtotal: null,
          free_over_amount: null,
          delivery_min_days: null,
          delivery_max_days: null,
          pickup_address: null,
          sort_order: 0,
          active: true,
          ...rateOverrides,
        },
      ],
    };
  }

  it('verifies and orders a null-country merchant ship rate instead of 400ing ZONE_MISMATCH', async () => {
    // Arrange — the merchant has no `merchants.country`. The order route must
    // apply the SAME `?? 'NG'` domestic fallback the quote path uses; passing
    // `null` would leave the verifier unable to resolve a destination (the
    // payload carries no country) and reject a purchasable rate with
    // SHIPPING_RATE_ZONE_MISMATCH.
    const admin = primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();
    const nullCountryMerchant = {
      data: {
        id: MERCHANT_ID,
        business_name: 'Test Merchant',
        country: null,
        slug: 'test-merchant',
        support_email: 'support@example.com',
        email_sender_name: 'Test Store',
        email: 'merchant@example.com',
      },
      error: null,
    };
    // `from()` returns the shared chainable for every table, so overriding its
    // single/maybeSingle swaps in the null-country merchant everywhere it is read.
    const merchantsChain = supabase.from('merchants');
    merchantsChain.single = vi.fn().mockResolvedValue(nullCountryMerchant);
    merchantsChain.maybeSingle = vi.fn().mockResolvedValue(nullCountryMerchant);

    // Act — ships to state 'Lagos' with no country in the payload.
    const response = await POST(rateOrderRequest());

    // Assert — the NG fallback resolves the Lagos zone; the rate verifies.
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_shipping_fee: 1500 })
    );
    expect(admin.update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
    });
  });

  it('verifies and orders a blank-country ("") merchant ship rate instead of 400ing ZONE_MISMATCH', async () => {
    // Arrange — the merchant's `merchants.country` is the EMPTY STRING, not NULL.
    // The normalization migration backfilled only NULL and free-text 'Nigeria',
    // so a `''` row still exists in production. `?? 'NG'` would pass `''`
    // through (it only catches NULL/undefined), leaving the verifier unable to
    // resolve a destination and rejecting a purchasable rate with
    // SHIPPING_RATE_ZONE_MISMATCH. The order path must trim-then-default blank to
    // NG exactly like the quote path normalizes a blank countryCode.
    const admin = primeAdminShippingRateClient(shippingRatesRpcPayload());
    const supabase = await primeStorefrontClient();
    const blankCountryMerchant = {
      data: {
        id: MERCHANT_ID,
        business_name: 'Test Merchant',
        country: '',
        slug: 'test-merchant',
        support_email: 'support@example.com',
        email_sender_name: 'Test Store',
        email: 'merchant@example.com',
      },
      error: null,
    };
    // `from()` returns the shared chainable for every table, so overriding its
    // single/maybeSingle swaps in the blank-country merchant everywhere it is read.
    const merchantsChain = supabase.from('merchants');
    merchantsChain.single = vi.fn().mockResolvedValue(blankCountryMerchant);
    merchantsChain.maybeSingle = vi
      .fn()
      .mockResolvedValue(blankCountryMerchant);

    // Act — ships to state 'Lagos' with no country in the payload.
    const response = await POST(rateOrderRequest());

    // Assert — the NG fallback resolves the Lagos zone; the rate verifies and
    // orders (not a 400 ZONE_MISMATCH).
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_shipping_fee: 1500 })
    );
    expect(admin.update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
    });
  });

  it('persists provider + rate-name with a null id when the rate is deleted before the post-create stamp', async () => {
    // Arrange — verification succeeds, but the merchant deletes the rate before
    // the stamp, so the first UPDATE's shipping_rate_id violates
    // orders_shipping_rate_id_fkey (Postgres foreign_key_violation, 23503).
    // Provider + rate-name are durable fulfillment data and must survive: the
    // route retries with a null soft-link id.
    const foreignKeyError = {
      code: '23503',
      message:
        'insert or update on table "orders" violates foreign key constraint "orders_shipping_rate_id_fkey"',
      details: '',
      hint: '',
    };
    const updateEqSecond = vi
      .fn()
      .mockResolvedValueOnce({ error: foreignKeyError })
      .mockResolvedValue({ error: null });
    const updateEqFirst = vi.fn(() => ({ eq: updateEqSecond }));
    const update = vi.fn(() => ({ eq: updateEqFirst }));
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? { data: shippingRatesRpcPayload(), error: null }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { currency: 'NGN' }, error: null }),
        update,
      })),
      rpc,
    } as never);
    const supabase = await primeStorefrontClient();

    // Act — no idempotency key, so verification runs and the stamp fires.
    const response = await POST(rateOrderRequest());

    // Assert — the order is created (the stamp is best-effort, never fails it),
    // and the retry persisted provider + name with a null soft-link id.
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.any(Object)
    );
    // The stamp is the first admin UPDATE (before any background side effects):
    // call 1 hits the FK violation, call 2 is the null-id retry.
    expect(update).toHaveBeenNthCalledWith(1, {
      shipping_provider: 'MERCHANT',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      shipping_provider: 'MERCHANT',
      shipping_rate_id: null,
      shipping_rate_name: 'Lagos Standard',
    });
  });

  it('carries the pickup snapshot into the null-id retry when the rate is deleted before the stamp', async () => {
    // Arrange — a PICKUP rate with a collection address. The first stamp hits
    // 23503 (rate deleted mid-order); the retry must still persist the durable
    // pickup snapshot alongside the provider + rate-name.
    const foreignKeyError = {
      code: '23503',
      message:
        'insert or update on table "orders" violates foreign key constraint "orders_shipping_rate_id_fkey"',
      details: '',
      hint: '',
    };
    const updateEqSecond = vi
      .fn()
      .mockResolvedValueOnce({ error: foreignKeyError })
      .mockResolvedValue({ error: null });
    const updateEqFirst = vi.fn(() => ({ eq: updateEqSecond }));
    const update = vi.fn(() => ({ eq: updateEqFirst }));
    const rpc = vi.fn((name: string) =>
      Promise.resolve(
        name === 'get_storefront_shipping_rates'
          ? {
              data: shippingRatesRpcPayload({
                kind: 'pickup',
                pickup_address: {
                  label: 'Ikeja Pickup Hub',
                  address: '5 Allen Avenue',
                  city: 'Ikeja',
                  state: 'Lagos',
                  country_code: 'NG',
                  instructions: 'Ask for the front desk',
                },
              }),
              error: null,
            }
          : { data: null, error: null }
      )
    );
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { currency: 'NGN' }, error: null }),
        update,
      })),
      rpc,
    } as never);
    await primeStorefrontClient();

    // Act
    const response = await POST(rateOrderRequest());

    // Assert — the order is created and the retry keeps the pickup snapshot.
    const expectedPickupDetails = {
      label: 'Ikeja Pickup Hub',
      address: '5 Allen Avenue',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: 'NG',
      instructions: 'Ask for the front desk',
    };
    expect(response.status).toBe(201);
    expect(update).toHaveBeenNthCalledWith(1, {
      shipping_provider: 'MERCHANT_PICKUP',
      shipping_rate_id: LAGOS_RATE_ID,
      shipping_rate_name: 'Lagos Standard',
      shipping_pickup_details: expectedPickupDetails,
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      shipping_provider: 'MERCHANT_PICKUP',
      shipping_rate_id: null,
      shipping_rate_name: 'Lagos Standard',
      shipping_pickup_details: expectedPickupDetails,
    });
  });

  it('rejects a ship-rate order that omits the delivery address with 400 SHIPPING_ADDRESS_REQUIRED', async () => {
    // Arrange — a rest-of-world ship rate verifies via the merchant-country
    // fallback with no address, so the door-delivery guard is the only thing
    // standing between a buggy caller and an unfulfillable MERCHANT order.
    const admin = primeAdminShippingRateClient(rowRateRpcPayload());
    const supabase = await primeStorefrontClient();

    // Act — select the ship rate but send no shipping_address at all.
    const response = await POST(
      rateOrderRequest({
        shipping_rate_id: ROW_RATE_ID,
        shipping_address: undefined,
      })
    );

    // Assert — rejected before the order RPC and before any provider stamp.
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({
      code: 'SHIPPING_ADDRESS_REQUIRED',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('creates a pickup-rate order without a delivery address', async () => {
    // Arrange — a rest-of-world PICKUP rate. The shopper collects, so a delivery
    // address is not required and the order must succeed.
    const admin = primeAdminShippingRateClient(
      rowRateRpcPayload({ kind: 'pickup' })
    );
    const supabase = await primeStorefrontClient();

    // Act — pickup rate with no shipping_address.
    const response = await POST(
      rateOrderRequest({
        shipping_rate_id: ROW_RATE_ID,
        shipping_address: undefined,
      })
    );

    // Assert — order created and stamped as pickup fulfillment. The pickup
    // snapshot is written (null here — the rate carries no collection address).
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_shipping_fee: 1500 })
    );
    expect(admin.update).toHaveBeenCalledWith({
      shipping_provider: 'MERCHANT_PICKUP',
      shipping_rate_id: ROW_RATE_ID,
      shipping_rate_name: 'Nationwide Delivery',
      shipping_pickup_details: null,
    });
  });
});
