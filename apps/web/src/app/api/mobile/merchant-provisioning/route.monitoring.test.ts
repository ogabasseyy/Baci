import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  getMobileBearerUser: vi.fn(),
  loadStarterFacts: vi.fn(),
  provisionHomepage: vi.fn(),
  provisionMerchant: vi.fn(),
  recordContract: vi.fn(),
  recordLifecycle: vi.fn(),
}));

vi.mock('./get-mobile-bearer-user', () => ({
  getMobileBearerUser: mocks.getMobileBearerUser,
}));
vi.mock('./provision-authenticated-merchant', async () => {
  const actual = await vi.importActual<
    typeof import('./provision-authenticated-merchant')
  >('./provision-authenticated-merchant');
  return { ...actual, provisionAuthenticatedMerchant: mocks.provisionMerchant };
});
vi.mock('./load-mobile-merchant-starter-facts', () => ({
  loadMobileMerchantStarterFacts: mocks.loadStarterFacts,
}));
vi.mock('@/lib/storefront-defaults/provision-curated-homepage', () => ({
  provisionCuratedHomepage: mocks.provisionHomepage,
}));
vi.mock('@/lib/posthog/mobile-onboarding-contract-telemetry', () => ({
  recordMobileOnboardingContractInvocation: mocks.recordContract,
}));
vi.mock('@/lib/posthog/mobile-signup-lifecycle-telemetry', () => ({
  recordMobileSignupLifecycle: mocks.recordLifecycle,
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

const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174000';
const validBody = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  businessName: 'Analytical Engines',
  businessType: 'technology',
  country: 'NG',
  slugIsCustom: false,
};

function request(attemptId = ATTEMPT_ID) {
  return new NextRequest(
    'https://usebaci.com/api/mobile/merchant-provisioning',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'X-Baci-Platform': 'ios',
        'X-Baci-Signup-Attempt-Id': attemptId,
      },
      body: JSON.stringify(validBody),
    }
  );
}

async function flushAfterCallbacks() {
  await Promise.all(mocks.afterCallbacks.map((callback) => callback()));
}

describe('POST /api/mobile/merchant-provisioning monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.getMobileBearerUser.mockResolvedValue({
      authenticated: true,
      supabase: {},
      user: { id: 'user-1' },
    });
    mocks.provisionMerchant.mockResolvedValue({
      created: true,
      merchantId: 'merchant-1',
      merchantSlug: 'analytical-engines',
    });
    mocks.loadStarterFacts.mockResolvedValue({
      brandColors: null,
      businessName: 'Analytical Engines',
      businessType: 'technology',
      merchantId: 'merchant-1',
      merchantLogoUrl: null,
      merchantSlug: 'analytical-engines',
    });
    mocks.provisionHomepage.mockResolvedValue({ status: 'created' });
    mocks.recordContract.mockResolvedValue(undefined);
    mocks.recordLifecycle.mockResolvedValue(undefined);
  });

  it('correlates an authoritative success without customer or merchant identifiers', async () => {
    const response = await POST(request());
    await flushAfterCallbacks();

    expect(response.status).toBe(200);
    expect(mocks.recordLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        eventCode: 'merchant_provisioning_succeeded',
        httpStatus: 200,
        outcome: 'succeeded',
        platform: 'ios',
        stage: 'provisioning',
      })
    );
    const telemetry = JSON.stringify(mocks.recordLifecycle.mock.calls[0]);
    expect(telemetry).not.toContain('user-1');
    expect(telemetry).not.toContain('merchant-1');
    expect(telemetry).not.toContain('Analytical Engines');
  });

  it('ignores malformed correlation input without breaking provisioning', async () => {
    const response = await POST(request('owner@example.com'));
    await flushAfterCallbacks();

    expect(response.status).toBe(200);
    expect(mocks.recordLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: null, outcome: 'succeeded' })
    );
  });

  it('classifies unexpected Postgres failures and schedules exception capture', async () => {
    const error = Object.assign(new Error('password=secret'), {
      code: '42501',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.provisionMerchant.mockRejectedValue(error);

    const response = await POST(request());
    await flushAfterCallbacks();

    expect(response.status).toBe(500);
    expect(mocks.recordLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        captureException: true,
        error,
        eventCode: 'merchant_provisioning_failed',
        failureClass: 'database',
        postgresCode: '42501',
        stage: 'rpc',
      })
    );
    errorSpy.mockRestore();
  });

  it('does not copy an unsafe database code into logs or lifecycle properties', async () => {
    const error = Object.assign(new Error('failed'), {
      code: 'owner@example.com password=secret',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.provisionMerchant.mockRejectedValue(error);

    await POST(request());
    await flushAfterCallbacks();

    const renderedLog = JSON.stringify(errorSpy.mock.calls);
    const { error: _capturedError, ...lifecycleProperties } = mocks
      .recordLifecycle.mock.calls[0]?.[0] as Record<string, unknown>;
    const renderedTelemetry = JSON.stringify(lifecycleProperties);
    expect(renderedLog).not.toContain('owner@example.com');
    expect(renderedLog).not.toContain('secret');
    expect(renderedTelemetry).not.toContain('owner@example.com');
    expect(renderedTelemetry).not.toContain('secret');
    expect(mocks.recordLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ postgresCode: null })
    );
    errorSpy.mockRestore();
  });

  it('distinguishes homepage setup failure from the provisioning RPC', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.provisionHomepage.mockResolvedValue({ status: 'failed' });

    const response = await POST(request());
    await flushAfterCallbacks();

    expect(response.status).toBe(500);
    expect(mocks.recordLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        failureClass: 'homepage',
        stage: 'homepage',
      })
    );
    expect(mocks.recordLifecycle.mock.calls[0]?.[0]).not.toHaveProperty(
      'captureException'
    );
    errorSpy.mockRestore();
  });
});
