import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureActionRateLimit: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  resolveOnboardingUser: vi.fn(),
  upsertOnboardingMerchant: vi.fn(),
  ensureOnboardingDomain: vi.fn(),
  provisionCuratedHomepage: vi.fn(),
  invalidateMerchantSlugRename: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));

vi.mock('@/env', () => ({
  getAppUrl: vi.fn(() => 'http://localhost:3000'),
  getConfiguredAppUrl: vi.fn(() => 'https://usebaci.com'),
  getRootDomain: vi.fn(() => 'usebaci.com'),
  isProduction: vi.fn(() => false),
}));

vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.ensureActionRateLimit,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('./resolve-onboarding-user', () => ({
  resolveOnboardingUser: mocks.resolveOnboardingUser,
}));

vi.mock('@/lib/invalidate-merchant-slug-rename', () => ({
  invalidateMerchantSlugRename: mocks.invalidateMerchantSlugRename,
}));

vi.mock('./upsert-onboarding-merchant', async () => {
  const actual = await vi.importActual<
    typeof import('./upsert-onboarding-merchant')
  >('./upsert-onboarding-merchant');
  return {
    OnboardingSlugUnavailableError: actual.OnboardingSlugUnavailableError,
    upsertOnboardingMerchant: mocks.upsertOnboardingMerchant,
  };
});

vi.mock('./ensure-onboarding-domain', () => ({
  ensureOnboardingDomain: mocks.ensureOnboardingDomain,
}));

vi.mock('@/lib/storefront-defaults/provision-curated-homepage', () => ({
  provisionCuratedHomepage: mocks.provisionCuratedHomepage,
}));

import { runSubmitOnboardingWorkflow } from './submit-onboarding-workflow';

function makeOnboardingFormData(slug: string): FormData {
  const fd = new FormData();
  fd.set('email', 'merchant@example.com');
  fd.set('password', 'StrongP@ss123!');
  fd.set('confirmPassword', 'StrongP@ss123!');
  fd.set('businessName', 'Kicks Hub');
  fd.set('businessType', 'fashion');
  fd.set('country', 'NG');
  fd.set('logoUrl', '');
  fd.set(
    'brandColors',
    JSON.stringify({
      primary: '#1E293B',
      background: '#FFFFFF',
      accent: '#F59E0B',
    })
  );
  fd.set('slug', slug);
  fd.set('slugIsCustom', 'true');
  return fd;
}

describe('runSubmitOnboardingWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActionRateLimit.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.resolveOnboardingUser.mockResolvedValue({
      status: 'authenticated',
      user: { id: 'user-1', email: 'merchant@example.com' },
    });
    mocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'created',
      updatedAt: '2026-11-26T00:00:00Z',
    });
  });

  it('retains the action rate-limit response before reaching authentication', async () => {
    mocks.ensureActionRateLimit.mockResolvedValue(false);

    await expect(
      runSubmitOnboardingWorkflow(
        { success: false, message: '' },
        new FormData()
      )
    ).resolves.toEqual({
      success: false,
      message: 'Too many onboarding attempts. Please try again later.',
    });
  });

  it('recovers from a domain conflict on retry when the merchant was already persisted', async () => {
    const persistedMerchant = {
      id: 'merchant-1',
      business_name: 'Kicks Hub',
      business_type: 'fashion',
      slug: 'taken-domain',
      logo_url: null,
      brand_colors: null,
    };

    // Attempt 1: merchant is newly saved, then domain fails with conflict.
    mocks.upsertOnboardingMerchant.mockResolvedValueOnce({
      status: 'saved',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      merchant: persistedMerchant,
    });
    mocks.ensureOnboardingDomain.mockResolvedValueOnce({ status: 'conflict' });

    const firstAttempt = await runSubmitOnboardingWorkflow(
      { success: false, message: '' },
      makeOnboardingFormData('taken-domain')
    );

    expect(firstAttempt).toEqual({
      success: false,
      code: 'slug_unavailable',
      message: 'That store link is already taken. Please choose another.',
    });

    // Attempt 2: upsert returns 'completed' with old slug; workflow renames to the
    // new custom slug, invalidates caches, ensures domain, and provisions homepage.
    mocks.upsertOnboardingMerchant.mockResolvedValueOnce({
      status: 'completed',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      merchant: persistedMerchant,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: { slug: 'kicks-hub-ng', retired_slug: 'taken-domain' },
      error: null,
    });
    mocks.ensureOnboardingDomain.mockResolvedValueOnce({ status: 'created' });

    const secondAttempt = await runSubmitOnboardingWorkflow(
      { success: false, message: '' },
      makeOnboardingFormData('kicks-hub-ng')
    );

    expect(mocks.rpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: 'merchant-1',
      p_new_slug: 'kicks-hub-ng',
    });
    expect(mocks.invalidateMerchantSlugRename).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      finalSlug: 'kicks-hub-ng',
      retiredSlug: 'taken-domain',
    });
    expect(mocks.ensureOnboardingDomain).toHaveBeenLastCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        slug: 'kicks-hub-ng',
      })
    );
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        merchantSlug: 'kicks-hub-ng',
      })
    );
    expect(secondAttempt).toEqual({
      success: true,
      message: 'Store created!',
      businessName: 'Kicks Hub',
      merchantId: 'merchant-1',
    });
  });

  it('renames a completed merchant whose existing domain already exists when a new custom slug is submitted', async () => {
    mocks.upsertOnboardingMerchant.mockResolvedValueOnce({
      status: 'completed',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      merchant: {
        id: 'merchant-1',
        business_name: 'Kicks Hub',
        business_type: 'fashion',
        slug: 'old-live-slug',
        logo_url: null,
        brand_colors: null,
      },
    });
    mocks.rpc.mockResolvedValueOnce({
      data: { slug: 'brand-new-slug', retired_slug: 'old-live-slug' },
      error: null,
    });
    mocks.ensureOnboardingDomain.mockResolvedValueOnce({
      status: 'already_exists',
    });

    const result = await runSubmitOnboardingWorkflow(
      { success: false, message: '' },
      makeOnboardingFormData('brand-new-slug')
    );

    expect(mocks.rpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: 'merchant-1',
      p_new_slug: 'brand-new-slug',
    });
    expect(mocks.invalidateMerchantSlugRename).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      finalSlug: 'brand-new-slug',
      retiredSlug: 'old-live-slug',
    });
    expect(mocks.ensureOnboardingDomain).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'brand-new-slug' })
    );
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({ merchantSlug: 'brand-new-slug' })
    );
    expect(result).toEqual({
      success: true,
      message: 'Store created!',
      businessName: 'Kicks Hub',
      merchantId: 'merchant-1',
    });
  });

  it('returns slug_unavailable when completed-merchant custom slug is reserved or taken', async () => {
    const persistedMerchant = {
      id: 'merchant-1',
      business_name: 'Kicks Hub',
      business_type: 'fashion',
      slug: 'taken-domain',
      logo_url: null,
      brand_colors: null,
    };

    mocks.upsertOnboardingMerchant.mockResolvedValueOnce({
      status: 'completed',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      merchant: persistedMerchant,
    });

    const reservedRetry = await runSubmitOnboardingWorkflow(
      { success: false, message: '' },
      makeOnboardingFormData('admin')
    );

    expect(reservedRetry).toMatchObject({
      success: false,
      code: 'slug_unavailable',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.upsertOnboardingMerchant.mockResolvedValueOnce({
      status: 'completed',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      merchant: persistedMerchant,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'slug_taken' },
    });

    const takenRetry = await runSubmitOnboardingWorkflow(
      { success: false, message: '' },
      makeOnboardingFormData('also-taken')
    );

    expect(takenRetry).toMatchObject({
      success: false,
      code: 'slug_unavailable',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: 'merchant-1',
      p_new_slug: 'also-taken',
    });
    expect(mocks.invalidateMerchantSlugRename).not.toHaveBeenCalled();
  });
});
