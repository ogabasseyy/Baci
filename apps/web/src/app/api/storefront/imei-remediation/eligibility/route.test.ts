import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createAssessment: vi.fn(),
  csrf: vi.fn(),
  enabled: true,
  loadEligibility: vi.fn(),
  rateLimit: vi.fn(),
  resolveCustomer: vi.fn(),
  resolveEligibility: vi.fn(),
  resolveMerchant: vi.fn(),
  startChecks: vi.fn(),
}));

vi.mock('@/env', () => ({
  getImeiHashSalt: () => 'hash-salt',
  getImeiIdentifierEncryptionKey: () => Buffer.alloc(32, 7).toString('base64'),
  getPetrockConfig: () => ({
    baseUrl: 'https://api.petrock.biz',
    token: 'token',
  }),
  getRootDomain: () => 'usebaci.com',
  isPetrockRemediationEnabled: () => mocks.enabled,
  isUsdtWalletEnabled: () => true,
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
  resolveImeiCustomer: mocks.resolveCustomer,
}));
vi.mock('@/lib/imei-remediation/petrock-remediation-eligibility-data', () => ({
  loadPetrockRemediationEligibility: mocks.loadEligibility,
}));
vi.mock('@/lib/imei-remediation/petrock-eligibility-engine', () => ({
  submitNextPetrockEligibilityCheck: mocks.startChecks,
}));
vi.mock('@/lib/imei-remediation/petrock-remediation-state', () => ({
  createPetrockEligibilityAssessment: mocks.createAssessment,
  createPetrockEligibilityState: () => ({
    resolveEligibility: mocks.resolveEligibility,
  }),
  readPetrockHouseCheckProduct: vi.fn(),
}));
vi.mock('@/lib/imei-providers/petrock/petrock-client', () => ({
  createPetrockClient: () => ({}),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { POST } from './route';

function request({
  merchantSlug,
  url = 'https://ogabassey.usebaci.com/api/remediation',
}: {
  merchantSlug?: string;
  url?: string;
} = {}) {
  return new Request(url, {
    body: JSON.stringify({
      identifier: '490154203237518',
      lookupId: '11111111-1111-4111-8111-111111111111',
      ...(merchantSlug ? { merchantSlug } : {}),
    }),
    method: 'POST',
  });
}

describe('POST /api/storefront/imei-remediation/eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.authenticate.mockResolvedValue({ supabase: {}, user: { id: 'u1' } });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveMerchant.mockResolvedValue({
      merchant: { id: 'merchant-1' },
      success: true,
    });
    mocks.resolveCustomer.mockResolvedValue({ id: 'customer-1' });
    mocks.loadEligibility.mockResolvedValue({
      evidence: {
        blacklistStatus: 'Clean',
        carrier: 'US AT&T',
        device: 'iPhone 17 Pro Max',
        financeStatus: 'Clean',
        simLock: 'Locked',
      },
      kind: 'eligible',
      needsAssessment: true,
      offers: [
        {
          carrier: 'AT&T',
          id: 'product-1',
          priceNgn: 100_000,
          priceUsdt: 65,
          refundPolicy: 'refundable',
          statusSegment: 'clean',
          turnaround: '1-7 Days',
        },
      ],
    });
    mocks.createAssessment.mockResolvedValue({
      eligibilityChecksCompleted: [],
      eligibilityEvidence: {},
      id: 'assessment-1',
      status: 'eligibility_pending',
    });
    mocks.startChecks.mockResolvedValue({ kind: 'pending' });
    mocks.resolveEligibility.mockResolvedValue(true);
  });

  it('returns reviewed clean-unlock offers', async () => {
    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assessmentId: 'assessment-1',
      offers: [{ carrier: 'AT&T', id: 'product-1' }],
      status: 'eligible',
      success: true,
      usdtEnabled: true,
    });
    expect(mocks.createAssessment).toHaveBeenCalled();
    expect(mocks.resolveEligibility).toHaveBeenCalledWith(
      expect.objectContaining({
        carrier: 'AT&T',
        orderId: 'assessment-1',
        statusSegment: 'clean',
      })
    );
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: undefined })
    );
  });

  it('uses the supplied merchant for a root-host path storefront', async () => {
    const response = await POST(
      request({
        merchantSlug: 'ogabassey',
        url: 'https://usebaci.com/api/remediation',
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('is indistinguishable from an absent feature while dark', async () => {
    mocks.enabled = false;
    const response = await POST(request() as never);

    expect(response.status).toBe(404);
    expect(mocks.loadEligibility).not.toHaveBeenCalled();
  });

  it('rate-limits authenticated eligibility checks before provider work', async () => {
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(429);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.loadEligibility).not.toHaveBeenCalled();
  });

  it('starts missing house checks without debiting the customer', async () => {
    mocks.loadEligibility.mockResolvedValue({
      checks: ['carrier_detection', 'carrier_status'],
      evidence: {
        carrier: 'Unknown',
        blacklistStatus: 'Clean',
        simLock: 'Locked',
      },
      kind: 'checks_required',
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(202);
    expect(mocks.createAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-1' })
    );
    expect(mocks.startChecks).toHaveBeenCalled();
  });
  it('blocks direct assessment requests without explicit clean and locked evidence', async () => {
    mocks.loadEligibility.mockResolvedValue({
      checks: ['blacklist'],
      evidence: { blacklistStatus: 'Unknown', simLock: 'Locked' },
      kind: 'checks_required',
    });
    const response = await POST(request() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'suppressed',
      offers: [],
    });
    expect(mocks.createAssessment).not.toHaveBeenCalled();
    expect(mocks.startChecks).not.toHaveBeenCalled();
  });
});
