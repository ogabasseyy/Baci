import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createClient: vi.fn(),
  csrf: vi.fn(),
  decrypt: vi.fn(),
  enabled: true,
  loadContext: vi.fn(),
  placeOrder: vi.fn(),
  rateLimit: vi.fn(),
  readOrders: vi.fn(),
  resolveCustomer: vi.fn(),
  resolveMerchant: vi.fn(),
  usdtEnabled: true,
}));

vi.mock('@/env', () => ({
  getImeiFxNgnUsd: () => 1575,
  getImeiHashSalt: () => 'hash-salt',
  getImeiIdentifierEncryptionKey: () => Buffer.alloc(32, 7).toString('base64'),
  getPetrockConfig: () => ({
    baseUrl: 'https://api.petrock.biz',
    token: 'token',
  }),
  getRootDomain: () => 'usebaci.com',
  isPetrockRemediationEnabled: () => mocks.enabled,
  isUsdtWalletEnabled: () => mocks.usdtEnabled,
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.rateLimit,
  createRateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolveMerchant,
}));
vi.mock('@/lib/imei-lookup-fulfillment', () => ({
  isInsufficientWalletBalanceError: (error: { message?: string }) =>
    error?.message === 'insufficient_wallet_balance',
  resolveImeiCustomer: mocks.resolveCustomer,
}));
vi.mock('@/lib/imei-identifier-crypto', () => ({
  decryptImeiIdentifier: mocks.decrypt,
}));
vi.mock('@/lib/imei-remediation/petrock-remediation-order-flow', () => ({
  placePetrockRemediationOrder: mocks.placeOrder,
}));
vi.mock('@/lib/imei-remediation/petrock-remediation-customer-orders', () => ({
  readCustomerPetrockRemediationOrders: mocks.readOrders,
}));
vi.mock('@/lib/imei-remediation/petrock-remediation-order-state', () => ({
  createPetrockRemediationOrderState: () => ({}),
  loadPetrockRemediationOrderContext: mocks.loadContext,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-client', () => ({
  createPetrockClient: mocks.createClient,
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { GET, POST } from './route';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function request(
  overrides: Record<string, unknown> = {},
  url = 'https://ogabassey.usebaci.com/api/remediation/orders'
) {
  return new Request(url, {
    body: JSON.stringify({
      identifier: '490154203237518',
      orderId: ORDER_ID,
      paymentCurrency: 'NGN',
      productId: PRODUCT_ID,
      ...overrides,
    }),
    method: 'POST',
  });
}

function context(status = 'eligible') {
  return {
    identifierCiphertext: 'ciphertext',
    identifierHash:
      '36d904a184e3a7c66e3e5ae9d25f5251856b8e92cd59a19f2c11e4c09a63db89',
    order: {
      costUsd: 75,
      customerId: 'customer-1',
      id: ORDER_ID,
      merchantId: 'merchant-1',
      paymentCurrency: null,
      status,
    },
    product: {
      active: true,
      catalogCostUsd: 75,
      catalogOrderFieldName: 'IMEI',
      catalogSyncedAt: new Date().toISOString(),
      curatedProductId: PRODUCT_ID,
      orderFieldName: 'IMEI',
      providerProductId: 'provider-product',
    },
  };
}

describe('POST /api/storefront/imei-remediation/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.usdtEnabled = true;
    mocks.authenticate.mockResolvedValue({
      supabase: {},
      user: { id: 'user-1' },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveMerchant.mockResolvedValue({
      merchant: { id: 'merchant-1' },
      success: true,
    });
    mocks.resolveCustomer.mockResolvedValue({ id: 'customer-1' });
    mocks.loadContext.mockResolvedValue(context());
    mocks.decrypt.mockReturnValue('490154203237518');
    mocks.placeOrder.mockResolvedValue({ kind: 'pending' });
    mocks.readOrders.mockResolvedValue([
      { id: ORDER_ID, status: 'in_progress' },
    ]);
    mocks.createClient.mockReturnValue({});
  });

  it('returns a safe conflict when stored evidence is no longer eligible', async () => {
    mocks.placeOrder.mockResolvedValue({ kind: 'eligibility_failed' });
    const response = await POST(request() as never);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'REMEDIATION_NOT_ELIGIBLE',
      success: false,
    });
  });

  it('authenticates before feature and request processing', async () => {
    mocks.authenticate.mockResolvedValue({ error: 'Unauthorized' });

    const response = await POST(request() as never);

    expect(response.status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it('rate-limits authenticated order submissions before payment work', async () => {
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(429);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it('lists only customer-safe unlock orders for the authenticated storefront', async () => {
    const response = await GET(request() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [{ id: ORDER_ID, status: 'in_progress' }],
      success: true,
    });
    expect(mocks.readOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        supabase: {},
      })
    );
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: null })
    );
  });

  it('uses the supplied merchant when listing from a root-host path storefront', async () => {
    const response = await GET(
      new Request(
        'https://usebaci.com/api/storefront/imei-remediation/orders?merchantSlug=ogabassey'
      ) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('places a validated capture-first order and returns pending', async () => {
    const response = await POST(
      request(
        { merchantSlug: 'ogabassey' },
        'https://usebaci.com/api/remediation/orders'
      ) as never
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      orderId: ORDER_ID,
      pollAfterMs: 30_000,
      status: 'submitted',
      success: true,
    });
    expect(mocks.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: '490154203237518',
        paymentCurrency: 'NGN',
      })
    );
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('returns 402 without submitting when the selected wallet is insufficient', async () => {
    mocks.placeOrder.mockRejectedValue(
      new Error('insufficient_wallet_balance')
    );

    const response = await POST(request() as never);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WALLET_INSUFFICIENT',
      success: false,
    });
  });

  it('replays an already-submitted order without another provider call', async () => {
    mocks.loadContext.mockResolvedValue(context('in_progress'));

    const response = await POST(request() as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      orderId: ORDER_ID,
      status: 'in_progress',
      success: true,
    });
    expect(mocks.placeOrder).not.toHaveBeenCalled();
  });

  it('fails closed when the identifier does not own the assessment', async () => {
    mocks.loadContext.mockResolvedValue({
      ...context(),
      identifierHash: '0'.repeat(64),
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(404);
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.placeOrder).not.toHaveBeenCalled();
  });

  it('keeps USDT ordering dark with the USDT wallet flag', async () => {
    mocks.usdtEnabled = false;

    const response = await POST(request({ paymentCurrency: 'USDT' }) as never);

    expect(response.status).toBe(404);
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it('returns a retryable 503 when provider preflight fails', async () => {
    mocks.placeOrder.mockResolvedValue({ kind: 'preflight_failed' });

    const response = await POST(request() as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'REMEDIATION_PREFLIGHT_FAILED',
      success: false,
    });
  });

  it('holds funds and exposes submission_unknown after an ambiguous timeout', async () => {
    mocks.placeOrder.mockResolvedValue({ kind: 'submission_unknown' });

    const response = await POST(request() as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'submission_unknown',
      success: true,
    });
  });
});
