import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkPollRateLimit: vi.fn(),
  claimPoll: vi.fn(),
  createAdminClient: vi.fn(),
  resolveCustomer: vi.fn(),
  resolveLookup: vi.fn(),
  resolveMerchant: vi.fn(),
}));

vi.mock('@/env', () => ({
  getImeiIdentifierEncryptionKey: () => Buffer.alloc(32, 7).toString('base64'),
  getPetrockConfig: () => ({
    baseUrl: 'https://api.petrock.biz/api/reseller/v1',
    token: 'token',
  }),
  getRootDomain: () => 'usebaci.com',
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkImeiPollRateLimit: mocks.checkPollRateLimit,
  createRateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolveMerchant,
}));
vi.mock('@/lib/imei-lookup-fulfillment', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/imei-lookup-fulfillment')
  >('@/lib/imei-lookup-fulfillment');
  return { ...actual, resolveImeiCustomer: mocks.resolveCustomer };
});
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-lookup-state', () => ({
  claimPetrockLookupPoll: mocks.claimPoll,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-lookup-resolution', () => ({
  resolveClaimedPetrockLookup: mocks.resolveLookup,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-client', () => ({
  createPetrockClient: () => ({}),
}));
vi.mock('@/lib/imei-providers/petrock/petrock-provider', () => ({
  createPetrockProvider: () => ({ poll: vi.fn() }),
}));

import { GET } from './route';

const LOOKUP_ID = '11111111-1111-4111-8111-111111111111';
const request = new Request(
  `https://ogabassey.usebaci.com/api/storefront/imei-check/${LOOKUP_ID}`
);

function context(id = LOOKUP_ID) {
  return { params: Promise.resolve({ lookupId: id }) };
}

function adminWithRow(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle,
    select: vi.fn(() => builder),
  };
  return { from: vi.fn(() => builder) };
}

describe('GET /api/storefront/imei-check/[lookupId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkPollRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    });
    mocks.authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user-1' },
    });
    mocks.resolveMerchant.mockResolvedValue({
      merchant: { id: 'merchant-1' },
      success: true,
    });
    mocks.resolveCustomer.mockResolvedValue({ id: 'customer-1' });
  });

  it('returns 401 when the customer is not authenticated', async () => {
    mocks.authenticate.mockResolvedValue({
      error: 'no',
      supabase: null,
      user: null,
    });

    const response = await GET(request, context());

    expect(response.status).toBe(401);
    expect(mocks.checkPollRateLimit).not.toHaveBeenCalled();
  });

  it('returns a customer-scoped cached terminal result', async () => {
    mocks.createAdminClient.mockReturnValue(
      adminWithRow({
        cached_response: { data: { device: 'iPhone' }, success: true },
        cached_status: 200,
        customer_id: 'customer-1',
        id: LOOKUP_ID,
        merchant_id: 'merchant-1',
        status: 'completed',
      })
    );

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lookupId: LOOKUP_ID,
      status: 'complete',
      success: true,
    });
  });

  it('uses the query merchant slug on a root-host path storefront', async () => {
    mocks.createAdminClient.mockReturnValue(
      adminWithRow({
        cached_response: { data: { device: 'iPhone' }, success: true },
        cached_status: 200,
        customer_id: 'customer-1',
        id: LOOKUP_ID,
        merchant_id: 'merchant-1',
        status: 'completed',
      })
    );
    const rootRequest = new Request(
      `https://usebaci.com/api/storefront/imei-check/${LOOKUP_ID}?merchantSlug=ogabassey`
    );

    const response = await GET(rootRequest, context());

    expect(response.status).toBe(200);
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('rejects an invalid query merchant slug', async () => {
    const rootRequest = new Request(
      `https://usebaci.com/api/storefront/imei-check/${LOOKUP_ID}?merchantSlug=../another-store`
    );

    const response = await GET(rootRequest, context());

    expect(response.status).toBe(400);
    expect(mocks.resolveMerchant).not.toHaveBeenCalled();
  });

  it('does not expose a lookup owned by another customer', async () => {
    mocks.createAdminClient.mockReturnValue(
      adminWithRow({
        cached_response: null,
        cached_status: null,
        customer_id: 'customer-2',
        id: LOOKUP_ID,
        merchant_id: 'merchant-1',
        status: 'pending_provider',
      })
    );

    const response = await GET(request, context());

    expect(response.status).toBe(404);
  });

  it('claims a due provider poll and returns the resolved result', async () => {
    mocks.createAdminClient.mockReturnValue(
      adminWithRow({
        cached_response: null,
        cached_status: null,
        customer_id: 'customer-1',
        id: LOOKUP_ID,
        merchant_id: 'merchant-1',
        status: 'pending_provider',
      })
    );
    mocks.claimPoll.mockResolvedValue({
      id: LOOKUP_ID,
      identifier_ciphertext: 'ciphertext',
      lease_token: 'lease-1',
      provider_order_id: 'order-1',
      status: 'pending_provider',
      tier: 'blacklist',
    });
    mocks.resolveLookup.mockResolvedValue({
      body: { data: { device: 'iPhone' }, status: 'complete', success: true },
      kind: 'complete',
      status: 200,
    });

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lookupId: LOOKUP_ID,
      status: 'complete',
    });
  });

  it('returns pending when a claimed poll loses its write lease', async () => {
    mocks.createAdminClient.mockReturnValue(
      adminWithRow({
        cached_response: null,
        cached_status: null,
        customer_id: 'customer-1',
        id: LOOKUP_ID,
        merchant_id: 'merchant-1',
        status: 'pending_provider',
      })
    );
    mocks.claimPoll.mockResolvedValue({
      id: LOOKUP_ID,
      identifier_ciphertext: 'ciphertext',
      lease_token: 'lease-1',
      provider_order_id: 'order-1',
      status: 'pending_provider',
      tier: 'blacklist',
    });
    mocks.resolveLookup.mockResolvedValue({
      kind: 'lease_lost',
      pollAfterMs: 5000,
    });

    const response = await GET(request, context());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      lookupId: LOOKUP_ID,
      status: 'pending',
    });
  });
});

vi.mock('@/lib/imei-device-catalog', () => ({
  enrichImeiDeviceResult: vi.fn(
    async (_merchantId: string, result: unknown) => result
  ),
}));
