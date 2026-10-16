import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

type ServerModule = typeof import('next/server');

type MutationRecord = {
  filters: [string, unknown][];
  payload: Record<string, unknown>;
};

type TransactionRecord = {
  amount: number;
  gateway: string;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  status: string;
};

type MerchantRecord = {
  id: string;
  plan_expires_at?: string | null;
  plan_tier?: string | null;
  premium_features?: string[];
};

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  claimResult: { data: { id: 'claimed' }, error: null } as {
    data: { id: string } | null;
    error: { message: string } | null;
  },
  domainMutations: [] as MutationRecord[],
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  revalidateMerchantFeed: vi.fn(),
  transactionMutationError: null as { message: string } | null,
  transactionMutations: [] as MutationRecord[],
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/config/domain-pricing', () => ({
  calculateDomainPrice: vi.fn(() => ({ sellPrice: 100 })),
  getDomainPricing: vi.fn(() => ({ registration: 100 })),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchantFeed: (...args: unknown[]) =>
    mocks.revalidateMerchantFeed(...args),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
  toUserAccess: vi.fn(() => ({})),
}));

vi.mock('@/lib/go54', () => ({
  isGo54Configured: vi.fn(() => true),
  registerDomain: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  verifyTransaction: (...args: unknown[]) =>
    mocks.verifyPaystackPayment(...args),
}));

function createMutationQuery(payload: Record<string, unknown>) {
  const mutation: MutationRecord = { filters: [], payload };
  mocks.transactionMutations.push(mutation);

  const query = {
    eq(column: string, value: unknown) {
      mutation.filters.push([column, value]);
      const isPaymentUsedMetadataWrite =
        typeof payload.metadata === 'object' &&
        payload.metadata !== null &&
        'domain_purchased' in payload.metadata;
      return isPaymentUsedMetadataWrite && mutation.filters.length === 2
        ? Promise.resolve({ error: mocks.transactionMutationError })
        : query;
    },
    // Fulfillment-claim chain:
    // .eq('id', ...).is(...).or(...).select('id').maybeSingle()
    is: () => query,
    or: () => query,
    select: () => query,
    maybeSingle: () => Promise.resolve(mocks.claimResult),
  };

  return query;
}

function createSupabase(
  transaction: TransactionRecord,
  merchant: MerchantRecord = {
    id: 'merchant-1',
    plan_expires_at: null,
    plan_tier: 'pro',
    premium_features: [],
  },
  existingDomain: {
    domain_type?: string;
    go54_order_id?: string | null;
    id: string;
    is_primary?: boolean;
    merchant_id: string;
    status?: string;
  } | null = {
    domain_type: 'purchased',
    go54_order_id: null,
    id: 'domain-1',
    is_primary: false,
    merchant_id: 'merchant-1',
    status: 'active',
  }
) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { email: 'merchant@example.com', id: 'user-1' } },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: merchant,
                error: null,
              }),
            })),
          })),
        };
      }

      if (table === 'transactions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: transaction,
                error: null,
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) =>
            createMutationQuery(payload)
          ),
        };
      }

      if (table === 'domains') {
        // Fully chainable: covers the existing-domain lookup and the
        // primary-promotion query (.select().eq().in().eq().eq().limit()).
        const domainsChain = {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          limit: vi.fn(),
          update: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: existingDomain,
            error: null,
          }),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'domain-repaired',
                  domain: 'shop.com',
                  status: 'active',
                  is_primary: false,
                },
                error: null,
              }),
            })),
          })),
        };
        domainsChain.select.mockReturnValue(domainsChain);
        domainsChain.eq.mockReturnValue(domainsChain);
        domainsChain.in.mockReturnValue(domainsChain);
        domainsChain.limit.mockReturnValue(domainsChain);
        domainsChain.update.mockImplementation(
          (payload: Record<string, unknown>) => {
            const mutation: MutationRecord = { filters: [], payload };
            mocks.domainMutations.push(mutation);
            return {
              eq: vi.fn((column: string, value: unknown) => {
                mutation.filters.push([column, value]);
                return Promise.resolve({ error: null });
              }),
            };
          }
        );
        return domainsChain;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

let supabase: ReturnType<typeof createSupabase>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => supabase),
}));

// Fulfillment writes (mark-purchased, claim) go through the admin client;
// route the same mock so mutations are recorded identically.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => supabase),
}));

function createRequest() {
  return new NextRequest('http://localhost/api/domains/purchase', {
    method: 'POST',
    body: JSON.stringify({
      domain: 'shop.com',
      paymentReference: 'payment-ref',
    }),
  });
}

describe('POST /api/domains/purchase transaction scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.domainMutations.length = 0;
    mocks.transactionMutations.length = 0;
    mocks.transactionMutationError = null;
    mocks.claimResult = { data: { id: 'claimed' }, error: null };
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { status: 'success' },
      success: true,
    });
  });

  it('does not update a pending transaction for another merchant without an owner filter', async () => {
    supabase = createSupabase({
      amount: 100,
      gateway: 'paystack',
      id: 'transaction-foreign',
      merchant_id: 'merchant-2',
      metadata: null,
      status: 'pending',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(mocks.transactionMutations).toHaveLength(1);
    expect(mocks.transactionMutations[0].payload).toMatchObject({
      status: 'completed',
    });
    expect(mocks.transactionMutations[0].filters).toEqual([
      ['id', 'transaction-foreign'],
      ['merchant_id', 'merchant-1'],
    ]);
  });

  it('scopes the payment-used metadata update to the authenticated merchant', async () => {
    supabase = createSupabase({
      amount: 100,
      gateway: 'paystack',
      id: 'transaction-owned',
      merchant_id: 'merchant-1',
      metadata: null,
      status: 'completed',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mocks.transactionMutations).toHaveLength(1);
    expect(mocks.transactionMutations[0].payload).toMatchObject({
      metadata: expect.objectContaining({ domain_purchased: 'shop.com' }),
    });
    expect(mocks.transactionMutations[0].filters).toEqual([
      ['id', 'transaction-owned'],
      ['merchant_id', 'merchant-1'],
    ]);
    expect(mocks.revalidateMerchantFeed).toHaveBeenCalledWith('merchant-1');
  });

  it('registers before fulfilling a fresh payment when an existing row lacks registrar proof', async () => {
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      undefined,
      { id: 'domain-1', merchant_id: 'merchant-1', status: 'pending' }
    );

    const { registerDomain } = await import('@/lib/go54');
    vi.mocked(registerDomain).mockResolvedValue({
      success: true,
      orderId: 'go54-fresh-1',
    } as never);

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.domain.status).toBe('active');
    expect(registerDomain).toHaveBeenCalledTimes(1);
    expect(mocks.domainMutations).toHaveLength(1);
    expect(mocks.domainMutations[0].payload).toMatchObject({
      go54_order_id: 'go54-fresh-1',
      status: 'active',
      ssl_status: 'active',
      purchase_price: 100,
      renewal_price: 100,
    });
    expect(mocks.domainMutations[0].filters).toEqual([['id', 'domain-1']]);
    expect(
      mocks.transactionMutations.some(
        (mutation) =>
          (mutation.payload.metadata as Record<string, unknown> | undefined)
            ?.domain_purchased === 'shop.com'
      )
    ).toBe(true);
  });

  it('fails closed after fresh registration when the payment cannot be marked as used', async () => {
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      undefined,
      null
    );
    mocks.transactionMutationError = { message: 'metadata write failed' };

    const { registerDomain } = await import('@/lib/go54');
    vi.mocked(registerDomain).mockResolvedValue({
      success: true,
      orderId: 'go54-fresh-1',
    } as never);

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toContain('payment usage could not be recorded');
    expect(registerDomain).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateMerchantFeed).not.toHaveBeenCalled();
  });

  it('fails closed when an existing domain payment cannot be marked as used', async () => {
    supabase = createSupabase({
      amount: 100,
      gateway: 'paystack',
      id: 'transaction-owned',
      merchant_id: 'merchant-1',
      metadata: null,
      status: 'completed',
    });
    mocks.transactionMutationError = { message: 'metadata write failed' };

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toContain('payment usage could not be recorded');
    expect(mocks.revalidateMerchantFeed).not.toHaveBeenCalled();
  });

  it('returns 409 without calling the registrar when the fulfillment claim is contested (review #2991 P1 regression test)', async () => {
    // The webhook can fulfill the same completed payment concurrently; the
    // claim loser must never call the registrar or the payment would be
    // registered (and charged at the registrar) twice.
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      undefined,
      null // no existing domain: the route proceeds toward registration
    );
    mocks.claimResult = { data: null, error: null }; // webhook holds the claim

    const { registerDomain } = await import('@/lib/go54');

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toContain('already in progress');
    expect(registerDomain).not.toHaveBeenCalled();
  });

  it('releases the fulfillment claim when Go54 throws a definitive registrar rejection', async () => {
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      undefined,
      null
    );

    const { registerDomain } = await import('@/lib/go54');
    vi.mocked(registerDomain).mockRejectedValue(
      new Error('Go54 API Error: {"message":"invalid contact data"}')
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(502);
    expect(registerDomain).toHaveBeenCalledTimes(1);
    expect(
      mocks.transactionMutations.some((mutation) => {
        const metadata = mutation.payload.metadata as
          | Record<string, unknown>
          | undefined;
        return metadata && Object.keys(metadata).length === 0;
      })
    ).toBe(true);
  });

  it('retains the fulfillment claim when Go54 throws an ambiguous transport error', async () => {
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      undefined,
      null
    );

    const { registerDomain } = await import('@/lib/go54');
    vi.mocked(registerDomain).mockRejectedValue(
      new Error('socket timeout after request write')
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect(registerDomain).toHaveBeenCalledTimes(1);
    expect(
      mocks.transactionMutations.some((mutation) => {
        const metadata = mutation.payload.metadata as
          | Record<string, unknown>
          | undefined;
        return metadata && Object.keys(metadata).length === 0;
      })
    ).toBe(false);
  });

  it('verifies (never re-registers) a fulfilled payment whose domains row exists (review #2991 P2 regression test)', async () => {
    supabase = createSupabase({
      amount: 100,
      gateway: 'paystack',
      id: 'transaction-owned',
      merchant_id: 'merchant-1',
      metadata: { domain_purchased: 'shop.com', years: 1 },
      status: 'completed',
    });

    const { registerDomain } = await import('@/lib/go54');

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toContain('Successfully verified');
    expect(registerDomain).not.toHaveBeenCalled();
  });

  it('restores a missing domains row for a fulfilled payment without contacting the registrar (review #2991 P2 regression test)', async () => {
    // Go54 succeeded but the domains insert failed on the original attempt:
    // the retry must repair the row from payment metadata — never re-order.
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: {
          domain_purchased: 'shop.com',
          years: 1,
          purchased_at: '2026-07-08T00:00:00.000Z',
          domain_registrar_order_id: 'go54-123',
        },
        status: 'completed',
      },
      undefined,
      null // domains row missing
    );

    const { registerDomain } = await import('@/lib/go54');

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toContain('Successfully restored');
    expect(json.domain.id).toBe('domain-repaired');
    expect(registerDomain).not.toHaveBeenCalled();
  });

  it('verifies a fulfilled payment even when current pricing has risen above the paid amount (review #2991 P2 regression test)', async () => {
    // The payment was price-validated when initialized and charged; a later
    // price increase must not 402-block verifying/repairing the registered
    // domain. Current mocked price is 100; the old payment was 50.
    supabase = createSupabase({
      amount: 50,
      gateway: 'paystack',
      id: 'transaction-owned',
      merchant_id: 'merchant-1',
      metadata: { domain_purchased: 'shop.com', years: 1 },
      status: 'completed',
    });

    const { registerDomain } = await import('@/lib/go54');

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toContain('Successfully verified');
    expect(registerDomain).not.toHaveBeenCalled();
  });

  it('activates a pending fallback row for a fulfilled payment without contacting the registrar (review #2991 P2 regression test)', async () => {
    // The webhook's fulfillment catch persists a pending fallback row; the
    // retry must ACTIVATE it (the registrar order exists) — never re-order.
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: { domain_purchased: 'shop.com', years: 1 },
        status: 'completed',
      },
      undefined,
      { id: 'domain-1', merchant_id: 'merchant-1', status: 'pending' }
    );

    const { registerDomain } = await import('@/lib/go54');

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toContain('Successfully verified');
    expect(json.domain.status).toBe('active');
    expect(registerDomain).not.toHaveBeenCalled();
  });

  it('verifies an active custom domain owned by the merchant without contacting the registrar', async () => {
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      undefined,
      {
        domain_type: 'custom',
        go54_order_id: null,
        id: 'domain-custom',
        merchant_id: 'merchant-1',
        status: 'active',
      }
    );

    const { registerDomain } = await import('@/lib/go54');

    const response = await POST(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toContain('Successfully verified');
    expect(json.domain.id).toBe('domain-custom');
    expect(registerDomain).not.toHaveBeenCalled();
    expect(
      mocks.transactionMutations.some((mutation) => {
        const metadata = mutation.payload.metadata as
          | Record<string, unknown>
          | undefined;
        return metadata?.domain_purchased === 'shop.com';
      })
    ).toBe(true);
  });

  it('returns 402 before registration when custom domains are locked', async () => {
    supabase = createSupabase(
      {
        amount: 100,
        gateway: 'paystack',
        id: 'transaction-owned',
        merchant_id: 'merchant-1',
        metadata: null,
        status: 'completed',
      },
      {
        id: 'merchant-1',
        plan_expires_at: null,
        plan_tier: 'free',
        premium_features: [],
      }
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(402);
    const json = await response.json();
    expect(json.code).toBe('requires_upgrade');
    expect(mocks.verifyPaystackPayment).not.toHaveBeenCalled();
    expect(mocks.transactionMutations).toHaveLength(0);
  });
});
