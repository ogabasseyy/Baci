import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActionMocks,
  makeFormData,
  prevState,
  setupActionMocks,
  setupChainedMock,
  submitOnboarding,
  validFields,
} from './actions.test-support';

const mocks = getActionMocks();
describe('onboarding action starter storefront effects', () => {
  beforeEach(setupActionMocks);
  function readyMerchant() {
    mocks.adminMaybeSingle.mockResolvedValue({ data: null, error: null });
    setupChainedMock({
      id: 'merchant-1',
      slug: 'teststore',
      logo_url: 'https://example.com/logo.png',
    });
  }
  it('uses one authenticated client to ensure the domain before canonical homepage provisioning', async () => {
    readyMerchant();
    const result = await submitOnboarding(prevState, makeFormData(validFields));
    expect(result).toMatchObject({ success: true, merchantId: 'merchant-1' });
    expect(mocks.ensureOnboardingDomain).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-1', slug: 'teststore' })
    );
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOwnerUserId: 'user-123',
        merchantId: 'merchant-1',
        merchantLogoUrl: 'https://example.com/logo.png',
      })
    );
    expect(
      mocks.ensureOnboardingDomain.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.provisionCuratedHomepage.mock.invocationCallOrder[0] ?? 0
    );
  });
  it('reuses the exact domain before retrying a transient page failure', async () => {
    readyMerchant();
    mocks.ensureOnboardingDomain.mockResolvedValue({
      status: 'already_exists',
    });
    mocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'created',
      updatedAt: '2026-08-02T00:00:00Z',
    });

    await expect(
      submitOnboarding(prevState, makeFormData(validFields))
    ).resolves.toMatchObject({ success: true });
    expect(mocks.ensureOnboardingDomain).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-1', slug: 'teststore' })
    );
    expect(
      mocks.ensureOnboardingDomain.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.provisionCuratedHomepage.mock.invocationCallOrder[0] ?? 0
    );
  });
  it('reuses the exact domain after a transient page failure before persisted-fact recovery', async () => {
    const persistedPalette = {
      primary: '#112233',
      background: '#ffffff',
      accent: '#445566',
    };
    mocks.adminMaybeSingle
      .mockReset()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'merchant-1',
          business_name: 'Persisted Store',
          business_type: 'technology',
          slug: 'teststore',
          logo_url: 'https://cdn.example.com/persisted-logo.png',
          brand_colors: persistedPalette,
        },
        error: null,
      });
    setupChainedMock({
      id: 'merchant-1',
      slug: 'teststore',
      logo_url: 'https://example.com/logo.png',
    });
    mocks.ensureOnboardingDomain
      .mockResolvedValueOnce({ status: 'created' })
      .mockResolvedValueOnce({ status: 'already_exists' });
    mocks.provisionCuratedHomepage
      .mockResolvedValueOnce({ status: 'failed', stage: 'insert' })
      .mockResolvedValueOnce({ status: 'created', updatedAt: null });

    await expect(
      submitOnboarding(prevState, makeFormData(validFields))
    ).resolves.toMatchObject({ success: false });
    await expect(
      submitOnboarding(
        prevState,
        makeFormData({
          ...validFields,
          businessName: 'Conflicting Submission',
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

    expect(mocks.ensureOnboardingDomain.mock.calls[1]?.[0]).toMatchObject({
      merchantId: 'merchant-1',
      slug: 'teststore',
    });
    expect(mocks.provisionCuratedHomepage.mock.calls[1]?.[0]).toMatchObject({
      merchantSlug: 'teststore',
      businessName: 'Persisted Store',
      businessType: 'technology',
      merchantLogoUrl: 'https://cdn.example.com/persisted-logo.png',
      brandColors: persistedPalette,
    });
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
  });
  it('recovers a persisted owner after a transient domain failure before creating its homepage', async () => {
    const persistedPalette = {
      primary: '#112233',
      background: '#ffffff',
      accent: '#445566',
    };
    mocks.adminMaybeSingle
      .mockReset()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'merchant-1',
          business_name: 'Persisted Store',
          business_type: 'technology',
          slug: 'persisted-store',
          logo_url: 'https://cdn.example.com/persisted-logo.png',
          brand_colors: persistedPalette,
        },
        error: null,
      });
    setupChainedMock({ id: 'merchant-1', slug: 'persisted-store' });
    mocks.ensureOnboardingDomain
      .mockResolvedValueOnce({ status: 'failed', stage: 'read' })
      .mockResolvedValueOnce({ status: 'created' });

    await expect(
      submitOnboarding(
        prevState,
        makeFormData({ ...validFields, businessName: 'First Submission' })
      )
    ).resolves.toMatchObject({ success: false });
    expect(mocks.provisionCuratedHomepage).not.toHaveBeenCalled();
    const writesAfterFirstAttempt = mocks.adminInsert.mock.calls.length;

    await expect(
      submitOnboarding(
        prevState,
        makeFormData({
          ...validFields,
          businessName: 'Conflicting Submission',
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

    expect(mocks.ensureOnboardingDomain.mock.calls[1]?.[0]).toMatchObject({
      merchantId: 'merchant-1',
      slug: 'persisted-store',
    });
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        merchantSlug: 'persisted-store',
        businessName: 'Persisted Store',
        businessType: 'technology',
        merchantLogoUrl: 'https://cdn.example.com/persisted-logo.png',
        brandColors: persistedPalette,
      })
    );
    expect(
      mocks.ensureOnboardingDomain.mock.invocationCallOrder[1]
    ).toBeLessThan(
      mocks.provisionCuratedHomepage.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
    expect(mocks.adminInsert).toHaveBeenCalledTimes(writesAfterFirstAttempt);
  });
  it('blocks success and preserves a structured template failure log when canonical provisioning fails', async () => {
    readyMerchant();
    mocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'failed',
      stage: 'insert',
    });
    const result = await submitOnboarding(prevState, makeFormData(validFields));
    expect(result.success).toBe(false);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Template generation failed',
        merchantId: 'merchant-1',
      })
    );
  });
  it('blocks success when the exact domain cannot be ensured', async () => {
    readyMerchant();
    mocks.ensureOnboardingDomain.mockResolvedValue({ status: 'conflict' });
    await expect(
      submitOnboarding(prevState, makeFormData(validFields))
    ).resolves.toMatchObject({ success: false });
    expect(mocks.provisionCuratedHomepage).not.toHaveBeenCalled();
  });
  it('logs the failing setup stage internally without returning provider details', async () => {
    readyMerchant();
    mocks.ensureOnboardingDomain.mockRejectedValue(
      new Error('provider timeout request_id=internal-only')
    );

    const result = await submitOnboarding(prevState, makeFormData(validFields));

    expect(result).toEqual({
      success: false,
      message: 'Could not finish store setup. Please try again.',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Onboarding setup failed',
        stage: 'setup',
      })
    );
    expect(JSON.stringify(result)).not.toContain('internal-only');
  });
  it('succeeds without an external provider call because canonical provisioning is deterministic', async () => {
    readyMerchant();
    const fetch = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    vi.stubGlobal('fetch', fetch);

    await expect(
      submitOnboarding(prevState, makeFormData(validFields))
    ).resolves.toMatchObject({ success: true });
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('contains no privileged client, AI enqueue, server event, or hero-assignment dependency', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(platform)/onboarding/submit-onboarding-workflow.ts'
      ),
      'utf8'
    );
    for (const forbidden of [
      '@/lib/supabase/admin',
      '@/lib/supabase/service',
      'ai_jobs',
      'triggerAiStorefrontWorker',
      'recordPlatformDomainEvent',
      'assignHeroImagesToMerchant',
      'generateInitialTemplate',
    ])
      expect(source).not.toContain(forbidden);
  });
});
