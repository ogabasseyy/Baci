import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActionMocks,
  makeFormData,
  prevState,
  setupActionMocks,
  submitOnboarding,
  validFields,
} from './actions.test-support';

const mobile = vi.hoisted(() => ({
  getMobileBearerUser: vi.fn(),
  provisionAuthenticatedMerchant: vi.fn(),
  loadMobileMerchantStarterFacts: vi.fn(),
  recordContract: vi.fn(),
}));

vi.mock(
  '../../api/mobile/merchant-provisioning/get-mobile-bearer-user',
  () => ({
    getMobileBearerUser: mobile.getMobileBearerUser,
  })
);
vi.mock(
  '../../api/mobile/merchant-provisioning/provision-authenticated-merchant',
  async () => {
    const actual = await vi.importActual<
      typeof import('../../api/mobile/merchant-provisioning/provision-authenticated-merchant')
    >(
      '../../api/mobile/merchant-provisioning/provision-authenticated-merchant'
    );
    return {
      ...actual,
      provisionAuthenticatedMerchant: mobile.provisionAuthenticatedMerchant,
    };
  }
);
vi.mock(
  '../../api/mobile/merchant-provisioning/load-mobile-merchant-starter-facts',
  () => ({
    loadMobileMerchantStarterFacts: mobile.loadMobileMerchantStarterFacts,
  })
);
vi.mock('@/lib/posthog/mobile-onboarding-contract-telemetry', () => ({
  recordMobileOnboardingContractInvocation: mobile.recordContract,
}));
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: vi.fn() };
});

import { POST } from '../../api/mobile/merchant-provisioning/route';

const actionMocks = getActionMocks();
const persistedFacts = {
  merchantId: 'merchant-1',
  merchantSlug: 'persisted-store',
  businessName: 'Persisted Store',
  businessType: 'technology',
  merchantLogoUrl: 'https://cdn.example.com/persisted-logo.png',
  brandColors: {
    primary: '#112233',
    background: '#ffffff',
    accent: '#445566',
  },
};
const mobileUser = { id: 'user-123', email: 'merchant@example.com' };
const mobileSupabase = { rpc: vi.fn() };

function mobileRequest() {
  return new NextRequest(
    'https://usebaci.com/api/mobile/merchant-provisioning',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
        'X-Baci-Platform': 'ios',
      },
      body: JSON.stringify({
        firstName: 'Ada',
        lastName: 'Lovelace',
        businessName: 'Conflicting Submitted Name',
        businessType: 'fashion',
        country: 'NG',
        slug: 'conflicting-submitted-name',
        slugIsCustom: true,
        brandColors: {
          primary: '#abcdef',
          background: '#000000',
          accent: '#fedcba',
        },
      }),
    }
  );
}

function canonicalArguments(input: Record<string, unknown>) {
  return {
    merchantId: input.merchantId,
    merchantSlug: input.merchantSlug,
    businessName: input.businessName,
    businessType: input.businessType,
    brandColors: input.brandColors,
  };
}

describe('web and v2 mobile canonical starter-fact parity', () => {
  beforeEach(() => {
    setupActionMocks();
    actionMocks.adminMaybeSingle.mockResolvedValue({
      data: {
        id: persistedFacts.merchantId,
        business_name: persistedFacts.businessName,
        business_type: persistedFacts.businessType,
        country: 'NG',
        slug: persistedFacts.merchantSlug,
        logo_url: persistedFacts.merchantLogoUrl,
        brand_colors: persistedFacts.brandColors,
      },
      error: null,
    });
    actionMocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'created',
      updatedAt: null,
    });
    mobile.getMobileBearerUser.mockResolvedValue({
      authenticated: true,
      user: mobileUser,
      supabase: mobileSupabase,
    });
    mobile.provisionAuthenticatedMerchant.mockResolvedValue({
      merchantId: persistedFacts.merchantId,
      merchantSlug: 'rpc-slug',
      created: false,
    });
    mobile.loadMobileMerchantStarterFacts.mockResolvedValue(persistedFacts);
  });

  it('passes the same persisted canonical facts to the homepage service', async () => {
    await expect(
      submitOnboarding(
        prevState,
        makeFormData({
          ...validFields,
          businessName: 'Conflicting Submitted Name',
          businessType: 'fashion',
          logoUrl:
            'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/submitted-logo.png',
          brandColors: JSON.stringify({
            primary: '#abcdef',
            background: '#000000',
            accent: '#fedcba',
          }),
        })
      )
    ).resolves.toMatchObject({ success: true });
    await expect(POST(mobileRequest())).resolves.toMatchObject({ status: 200 });

    const [webCall, mobileCall] =
      actionMocks.provisionCuratedHomepage.mock.calls.map(([input]) =>
        canonicalArguments(input as Record<string, unknown>)
      );

    expect(webCall).toEqual(mobileCall);
    expect(webCall).toEqual({
      merchantId: 'merchant-1',
      merchantSlug: 'persisted-store',
      businessName: 'Persisted Store',
      businessType: 'technology',
      brandColors: persistedFacts.brandColors,
    });
  });
});
