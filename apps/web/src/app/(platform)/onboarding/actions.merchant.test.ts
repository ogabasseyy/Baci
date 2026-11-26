import { beforeEach, describe, expect, it } from 'vitest';
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

describe('onboarding action merchant persistence', () => {
  beforeEach(setupActionMocks);

  function noMerchant() {
    mocks.adminMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
  }

  it('sets signup_source to web when creating a new merchant', async () => {
    noMerchant();
    setupChainedMock({ id: 'merchant-1', slug: 'teststore' });

    const result = await submitOnboarding(prevState, makeFormData(validFields));

    expect(result.success).toBe(true);
    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        signup_source: 'web',
        business_name: 'TestStore',
        country: 'NG',
        email: 'merchant@example.com',
        payout_currency: 'NGN',
      })
    );
  });

  it('falls back to buildMerchantSlug when the RPC returns no usable data', async () => {
    noMerchant();
    setupChainedMock({ id: 'merchant-1', slug: 'baci-food-123' });

    const result = await submitOnboarding(
      prevState,
      makeFormData({ ...validFields, businessName: 'Baci Food 123' })
    );

    expect(result.success).toBe(true);
    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_name: 'Baci Food 123',
        slug: 'baci-food-123',
      })
    );
  });

  it('falls back to buildMerchantSlug when the slug RPC returns an error', async () => {
    noMerchant();
    mocks.adminRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC failed', code: 'XX000' },
    });
    setupChainedMock({ id: 'merchant-1', slug: 'teststore' });

    const result = await submitOnboarding(prevState, makeFormData(validFields));

    expect(result.success).toBe(true);
    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({ business_name: 'TestStore', slug: 'teststore' })
    );
  });

  it('falls back when the slug RPC returns a non-string payload', async () => {
    noMerchant();
    mocks.adminRpc.mockResolvedValueOnce({ data: 12345, error: null });
    setupChainedMock({ id: 'merchant-1', slug: 'teststore' });

    await submitOnboarding(prevState, makeFormData(validFields));

    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'teststore' })
    );
  });

  it('falls back when the slug RPC returns an empty / whitespace string', async () => {
    noMerchant();
    mocks.adminRpc.mockResolvedValueOnce({ data: '   ', error: null });
    setupChainedMock({ id: 'merchant-1', slug: 'teststore' });

    await submitOnboarding(prevState, makeFormData(validFields));

    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'teststore' })
    );
  });

  it('uses the database slug generator to avoid merchant slug collisions', async () => {
    noMerchant();
    mocks.adminRpc.mockResolvedValueOnce({ data: 'teststore-2', error: null });
    setupChainedMock({ id: 'merchant-1', slug: 'teststore-2' });

    await submitOnboarding(prevState, makeFormData(validFields));

    expect(mocks.adminRpc).toHaveBeenCalledWith('generate_slug', {
      text_input: 'TestStore',
    });
    expect(mocks.adminInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_name: 'TestStore',
        slug: 'teststore-2',
      })
    );
  });

  it('uses local app URL for password signup redirects outside production', async () => {
    mocks.getConfiguredAppUrl.mockReturnValue(null);
    noMerchant();
    setupChainedMock({ id: 'merchant-1', slug: 'teststore' });

    await submitOnboarding(prevState, makeFormData(validFields));

    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: 'http://localhost:3000/onboarding' },
      })
    );
  });

  it('does not set signup_source when updating an incomplete merchant', async () => {
    mocks.adminMaybeSingle.mockReset().mockResolvedValue({
      data: { id: 'existing-1', business_name: null },
      error: null,
    });
    setupChainedMock({ id: 'existing-1', slug: 'teststore' });

    const result = await submitOnboarding(prevState, makeFormData(validFields));

    expect(result.success).toBe(true);
    expect(mocks.adminInsert).not.toHaveBeenCalled();
    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'NG', payout_currency: 'NGN' })
    );
  });

  it('does not rewrite an established slug when completing a pending merchant', async () => {
    mocks.adminMaybeSingle.mockReset().mockResolvedValue({
      data: {
        id: 'existing-1',
        business_name: null,
        slug: '  merchant-chosen-slug  ',
      },
      error: null,
    });
    setupChainedMock({ id: 'existing-1', slug: '  merchant-chosen-slug  ' });

    const result = await submitOnboarding(
      prevState,
      makeFormData({ ...validFields, businessName: 'Renamed Business' })
    );

    expect(result.success).toBe(true);
    expect(mocks.adminRpc).not.toHaveBeenCalledWith('generate_slug', {
      text_input: 'Renamed Business',
    });
    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ business_name: 'Renamed Business' })
    );
    expect(mocks.adminUpdate.mock.calls[0]?.[0]).not.toHaveProperty('slug');
    expect(mocks.adminUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'renamed-business' })
    );
  });

  it('generates a unique slug when completing a pending merchant without an established slug', async () => {
    mocks.adminMaybeSingle.mockReset().mockResolvedValue({
      data: { id: 'existing-1', business_name: null, slug: null },
      error: null,
    });
    mocks.adminRpc.mockResolvedValueOnce({ data: 'teststore-2', error: null });
    setupChainedMock({ id: 'existing-1', slug: 'teststore-2' });

    await submitOnboarding(prevState, makeFormData(validFields));

    expect(mocks.adminRpc).toHaveBeenCalledWith('generate_slug', {
      text_input: 'TestStore',
    });
    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'teststore-2' })
    );
  });

  it('recovers an existing completed merchant through the insert-only starter path', async () => {
    mocks.adminMaybeSingle.mockReset().mockResolvedValue({
      data: {
        id: 'existing-1',
        business_name: 'Already Set Up',
        business_type: 'fashion',
        slug: 'already-set-up',
      },
      error: null,
    });
    mocks.provisionCuratedHomepage.mockResolvedValue({
      status: 'already_exists',
      updatedAt: '2026-08-02T00:00:00Z',
    });

    const result = await submitOnboarding(prevState, makeFormData(validFields));

    expect(result.success).toBe(true);
    expect(result.message).toContain('Welcome back');
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
    expect(mocks.adminInsert).not.toHaveBeenCalled();
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledOnce();
  });

  it('uses only persisted merchant facts when recovering a completed owner', async () => {
    const persistedPalette = {
      primary: '#112233',
      background: '#fefefe',
      accent: '#445566',
    };
    mocks.adminMaybeSingle.mockReset().mockResolvedValue({
      data: {
        id: 'existing-1',
        business_name: 'Persisted Store',
        business_type: 'technology',
        country: 'NG',
        slug: 'persisted-store',
        logo_url: 'https://cdn.example.com/persisted-logo.png',
        brand_colors: persistedPalette,
      },
      error: null,
    });

    const result = await submitOnboarding(
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
    );

    expect(result).toMatchObject({ success: true, merchantId: 'existing-1' });
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
    expect(mocks.provisionCuratedHomepage).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'existing-1',
        merchantSlug: 'persisted-store',
        merchantLogoUrl: 'https://cdn.example.com/persisted-logo.png',
        businessName: 'Persisted Store',
        businessType: 'technology',
        brandColors: persistedPalette,
      })
    );
  });
});
