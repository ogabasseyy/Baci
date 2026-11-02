import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettings } from './save-settings';

const mockUpdateSocial = vi.fn();
vi.mock('@/hooks/merchant/update-social', () => ({
  updateSocial: (...args: unknown[]) => mockUpdateSocial(...args),
}));
const mockUpdateStorefrontProfile = vi.fn();
vi.mock('./update-storefront-profile', () => ({
  updateStorefrontProfile: (...args: unknown[]) =>
    mockUpdateStorefrontProfile(...args),
}));
const mockGetMerchantSettingsSnapshot = vi.fn();
vi.mock('./get-merchant-settings-snapshot', () => ({
  getMerchantSettingsSnapshot: (...args: unknown[]) =>
    mockGetMerchantSettingsSnapshot(...args),
}));

const profileBaseline = {
  business_name: 'Test Store',
  country: 'NG',
  phone: '+2348012345678',
  site_description: '',
  support_email: '',
  support_phone: '',
  updated_at: '2026-08-04T05:00:00.000Z',
};

describe('saveSettings storefront profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantSettingsSnapshot.mockResolvedValue({
      ...profileBaseline,
      updated_at: '2026-08-04T06:00:00.000Z',
    });
  });

  it('persists changed public profile fields through the guarded OCC RPC', async () => {
    const updateMerchant = vi.fn();
    const toast = vi.fn();
    const setIsSaving = vi.fn();
    mockUpdateStorefrontProfile.mockResolvedValue(undefined);

    await expect(
      saveSettings({
        data: {
          ...profileBaseline,
          site_description: 'Updated description',
          support_email: 'support@example.com',
          support_phone: '+2348000000000',
        },
        heroSlides: [],
        heroSlidesEdited: false,
        merchantId: 'merchant-1',
        profileBaseline,
        socialMedia: null,
        updateMerchant,
        reloadMerchant: vi.fn(),
        isCurrentSave: () => true,
        toast,
        setIsSaving,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        profileSaved: true,
        snapshot: expect.objectContaining({
          updated_at: '2026-08-04T06:00:00.000Z',
        }),
      })
    );

    expect(mockUpdateStorefrontProfile).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      expectedUpdatedAt: '2026-08-04T05:00:00.000Z',
      settings: {
        site_description: 'Updated description',
        support_email: 'support@example.com',
        support_phone: '+2348000000000',
      },
    });
    expect(updateMerchant).not.toHaveBeenCalled();
    expect(mockGetMerchantSettingsSnapshot).toHaveBeenCalledWith('merchant-1');
  });

  it('uses the stale captured profile token before any social or hero write', async () => {
    const updateMerchant = vi.fn();
    const toast = vi.fn();
    const setIsSaving = vi.fn();
    mockUpdateStorefrontProfile.mockRejectedValue(
      new Error('merchant_settings_conflict')
    );

    await expect(
      saveSettings({
        data: { ...profileBaseline, site_description: 'Updated description' },
        heroSlides: [{ id: 'hero' }] as never,
        heroSlidesEdited: true,
        merchantId: 'merchant-1',
        profileBaseline,
        socialMedia: { twitter: '@test' },
        updateMerchant,
        reloadMerchant: vi.fn(),
        isCurrentSave: () => true,
        toast,
        setIsSaving,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'merchant_settings_conflict',
        }),
        profileSaved: false,
        socialSaved: false,
        heroSaved: false,
      })
    );

    expect(mockUpdateStorefrontProfile).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      expectedUpdatedAt: '2026-08-04T05:00:00.000Z',
      settings: { site_description: 'Updated description' },
    });
    expect(mockUpdateSocial).not.toHaveBeenCalled();
    expect(updateMerchant).not.toHaveBeenCalled();
    expect(mockGetMerchantSettingsSnapshot).not.toHaveBeenCalled();
  });

  it('stops before every write when a changed profile has no baseline token', async () => {
    const updateMerchant = vi.fn();
    const toast = vi.fn();
    const setIsSaving = vi.fn();

    await expect(
      saveSettings({
        data: { ...profileBaseline, site_description: 'Updated description' },
        heroSlides: [{ id: 'hero' }] as never,
        heroSlidesEdited: true,
        merchantId: 'merchant-1',
        profileBaseline: { ...profileBaseline, updated_at: undefined },
        socialMedia: { twitter: '@test' },
        updateMerchant,
        reloadMerchant: vi.fn(),
        isCurrentSave: () => true,
        toast,
        setIsSaving,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Store settings changed. Reload before saving again.',
        }),
        profileSaved: false,
        socialSaved: false,
        heroSaved: false,
      })
    );

    expect(mockUpdateStorefrontProfile).not.toHaveBeenCalled();
    expect(mockUpdateSocial).not.toHaveBeenCalled();
    expect(updateMerchant).not.toHaveBeenCalled();
  });

  it('returns the canonical snapshot and completed channels after a later partial failure', async () => {
    const updateMerchant = vi.fn();
    const toast = vi.fn();
    const setIsSaving = vi.fn();
    mockUpdateStorefrontProfile.mockResolvedValue(undefined);
    mockUpdateSocial.mockRejectedValue(new Error('Social update failed'));
    mockGetMerchantSettingsSnapshot.mockResolvedValue({
      ...profileBaseline,
      site_description: 'Saved description',
      updated_at: '2026-08-04T06:00:00.000Z',
    });

    await expect(
      saveSettings({
        data: { ...profileBaseline, site_description: 'Saved description' },
        heroSlides: [],
        heroSlidesEdited: true,
        merchantId: 'merchant-1',
        profileBaseline,
        socialMedia: { twitter: '@test' },
        updateMerchant,
        reloadMerchant: vi.fn(),
        isCurrentSave: () => true,
        toast,
        setIsSaving,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        profileSaved: true,
        socialSaved: false,
        heroSaved: false,
        snapshot: {
          ...profileBaseline,
          site_description: 'Saved description',
          updated_at: '2026-08-04T06:00:00.000Z',
        },
        error: expect.objectContaining({ message: 'Social update failed' }),
      })
    );
    expect(mockGetMerchantSettingsSnapshot).toHaveBeenCalledWith('merchant-1');
    expect(updateMerchant).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Settings Partially Saved',
      description: 'Saved your storefront profile, but Social update failed',
      variant: 'destructive',
    });
  });
  it('sends the business phone couriers call when the merchant changes it', async () => {
    mockUpdateStorefrontProfile.mockResolvedValue(undefined);

    await saveSettings({
      data: { ...profileBaseline, phone: '+234 803 123 4567' },
      heroSlides: [],
      heroSlidesEdited: false,
      merchantId: 'merchant-1',
      profileBaseline,
      socialMedia: null,
      updateMerchant: vi.fn(),
      reloadMerchant: vi.fn(),
      isCurrentSave: () => true,
      toast: vi.fn(),
      setIsSaving: vi.fn(),
    });

    expect(mockUpdateStorefrontProfile).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      expectedUpdatedAt: '2026-08-04T05:00:00.000Z',
      settings: { phone: '+234 803 123 4567' },
    });
  });

  it('never clears the stored business phone when a submission omits it', async () => {
    mockUpdateStorefrontProfile.mockResolvedValue(undefined);

    await saveSettings({
      data: {
        ...profileBaseline,
        phone: undefined as unknown as string,
        site_description: 'Updated description',
      },
      heroSlides: [],
      heroSlidesEdited: false,
      merchantId: 'merchant-1',
      profileBaseline,
      socialMedia: null,
      updateMerchant: vi.fn(),
      reloadMerchant: vi.fn(),
      isCurrentSave: () => true,
      toast: vi.fn(),
      setIsSaving: vi.fn(),
    });

    expect(mockUpdateStorefrontProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { site_description: 'Updated description' },
      })
    );
  });
});
