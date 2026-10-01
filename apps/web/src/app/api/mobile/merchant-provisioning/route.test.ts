import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileProvisioningError } from './provision-authenticated-merchant';

const mocks = vi.hoisted(() => ({
  getMobileBearerUser: vi.fn(),
  provisionAuthenticatedMerchant: vi.fn(),
  loadMobileMerchantStarterFacts: vi.fn(),
  provisionCuratedHomepage: vi.fn(),
  recordContract: vi.fn(),
  recordSignupLifecycle: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock('./get-mobile-bearer-user', () => ({
  getMobileBearerUser: mocks.getMobileBearerUser,
}));
vi.mock('./provision-authenticated-merchant', async () => {
  const actual = await vi.importActual<
    typeof import('./provision-authenticated-merchant')
  >('./provision-authenticated-merchant');
  return {
    ...actual,
    provisionAuthenticatedMerchant: mocks.provisionAuthenticatedMerchant,
  };
});
vi.mock('@/lib/storefront-defaults/provision-curated-homepage', () => ({
  provisionCuratedHomepage: mocks.provisionCuratedHomepage,
}));
vi.mock('./load-mobile-merchant-starter-facts', async () => {
  const actual = await vi.importActual<
    typeof import('./load-mobile-merchant-starter-facts')
  >('./load-mobile-merchant-starter-facts');
  return {
    ...actual,
    loadMobileMerchantStarterFacts: mocks.loadMobileMerchantStarterFacts,
  };
});
vi.mock('@/lib/posthog/mobile-onboarding-contract-telemetry', () => ({
  recordMobileOnboardingContractInvocation: mocks.recordContract,
}));
vi.mock('@/lib/posthog/mobile-signup-lifecycle-telemetry', () => ({
  recordMobileSignupLifecycle: mocks.recordSignupLifecycle,
}));
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: vi.fn((callback: () => Promise<void>) => {
      mocks.afterCallbacks.push(callback);
    }),
  };
});

import { POST } from './route';

const validBody = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  businessName: '  Analytical   Engines  ',
  businessType: 'technology',
  country: 'NG',
  slug: 'analytical-engines',
  slugIsCustom: true,
  brandColors: {
    primary: '#111111',
    background: '#ffffff',
    accent: '#f59e0b',
  },
};

function request(
  body: Record<string, unknown> = validBody,
  options: { authorization?: string; platform?: string } = {}
): NextRequest {
  return new NextRequest(
    'https://usebaci.com/api/mobile/merchant-provisioning',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.authorization
          ? { Authorization: options.authorization }
          : {}),
        ...(options.platform ? { 'X-Baci-Platform': options.platform } : {}),
      },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/mobile/merchant-provisioning', () => {
  const user = { id: 'user-1', email: 'ada@example.com' };
  const supabase = { rpc: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.getMobileBearerUser.mockResolvedValue({
      authenticated: true,
      user,
      supabase,
    });
    mocks.provisionAuthenticatedMerchant.mockResolvedValue({
      merchantId: 'merchant-1',
      merchantSlug: 'analytical-engines',
      created: true,
    });
    mocks.loadMobileMerchantStarterFacts.mockResolvedValue({
      merchantId: 'merchant-1',
      merchantSlug: 'analytical-engines',
      businessName: 'Analytical Engines',
      businessType: 'technology',
      merchantLogoUrl: null,
      brandColors: validBody.brandColors,
    });
    mocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'created',
      updatedAt: '2026-08-02T00:00:00Z',
    });
    mocks.recordContract.mockResolvedValue(undefined);
    mocks.recordSignupLifecycle.mockResolvedValue(undefined);
  });

  it('returns 401 before reading JSON when bearer authentication fails', async () => {
    const json = vi.fn();
    mocks.getMobileBearerUser.mockResolvedValue({ authenticated: false });
    const unauthenticatedRequest = {
      headers: new Headers({ Cookie: 'sb-session=valid-web-cookie' }),
      json,
    } as unknown as NextRequest;

    const response = await POST(unauthenticatedRequest);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      code: 'unauthorized',
    });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.recordContract).not.toHaveBeenCalled();
    expect(mocks.provisionAuthenticatedMerchant).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    'IOS',
    'web',
    'ios,android',
    'ios, ios',
  ])('rejects invalid platform header %s before reading JSON', async (platform) => {
    const req = request(validBody, {
      authorization: 'Bearer token',
      platform,
    });
    const json = vi.spyOn(req, 'json');

    const response = await POST(req);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_input',
    });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(2);
  });

  it('counts authenticated invalid data before validation and never calls RPC', async () => {
    const response = await POST(
      request(
        { ...validBody, password: 'must-not-be-accepted' },
        { authorization: 'Bearer token', platform: 'ios' }
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'invalid_input',
    });
    expect(mocks.provisionAuthenticatedMerchant).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(2);
    await mocks.afterCallbacks[0]?.();
    expect(mocks.recordContract).toHaveBeenCalledOnce();
  });

  it.each([
    'ios',
    'android',
  ] as const)('provisions once for exact %s and returns only stable merchant data', async (platform) => {
    const response = await POST(
      request(validBody, {
        authorization: 'Bearer token',
        platform,
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      merchant: { id: 'merchant-1', slug: 'analytical-engines' },
      created: true,
    });
    expect(mocks.provisionAuthenticatedMerchant).toHaveBeenCalledOnce();
    expect(mocks.provisionAuthenticatedMerchant).toHaveBeenCalledWith({
      supabase,
      user,
      platform,
      input: expect.objectContaining({
        businessName: 'Analytical Engines',
        country: 'NG',
      }),
    });
    expect(mocks.afterCallbacks).toHaveLength(2);
    await Promise.all(mocks.afterCallbacks.map((callback) => callback()));
    expect(mocks.recordContract).toHaveBeenCalledOnce();
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        expectedOwnerUserId: 'user-1',
        merchantId: 'merchant-1',
        merchantSlug: 'analytical-engines',
        businessName: 'Analytical Engines',
      })
    );
  });

  it.each([
    ['PT422', 422, 'identity_incomplete'],
    ['PT409', 409, 'slug_unavailable'],
    ['PT400', 400, 'invalid_input'],
  ] as const)('maps %s to %s %s', async (pgCode, status, code) => {
    mocks.provisionAuthenticatedMerchant.mockRejectedValue(
      new MobileProvisioningError(pgCode)
    );

    const response = await POST(
      request(validBody, {
        authorization: 'Bearer token',
        platform: 'android',
      })
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it('returns a secret-free structured 500 for unexpected RPC failures', async () => {
    const error = Object.assign(new Error('password=secret'), {
      code: '42501',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.provisionAuthenticatedMerchant.mockRejectedValue(error);

    const response = await POST(
      request(validBody, {
        authorization: 'Bearer token',
        platform: 'ios',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Could not finish store setup. Please try again.',
      code: 'provisioning_failed',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(errorSpy).toHaveBeenCalledWith(
      'mobile-merchant-provisioning %s',
      'provisioning_failed',
      JSON.stringify({ stage: 'rpc', pgCode: '42501' })
    );
    errorSpy.mockRestore();
  });

  it('does not return success until canonical homepage provisioning succeeds', async () => {
    mocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'failed',
      stage: 'insert',
    });

    const response = await POST(
      request(validBody, { authorization: 'Bearer token', platform: 'ios' })
    );

    expect(response.status).toBe(500);
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        expectedOwnerUserId: 'user-1',
        merchantId: 'merchant-1',
        merchantSlug: 'analytical-engines',
        businessName: 'Analytical Engines',
      })
    );
  });
});
