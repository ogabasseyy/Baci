import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';

const mocks = vi.hoisted(() => ({
  getMerchantSettingsSnapshot: vi.fn(),
  toast: vi.fn(),
  updateStorefrontProfile: vi.fn(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ reloadMerchant: vi.fn(), updateMerchant: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/hooks/merchant/update-social', () => ({ updateSocial: vi.fn() }));
vi.mock('@/app/dashboard/settings/favicon-upload', () => ({
  FaviconUpload: () => null,
}));
vi.mock('@/components/dashboard/dashboard-ad-unit', () => ({
  DashboardAdUnit: () => null,
}));
vi.mock('./branding-card', () => ({ BrandingCard: () => null }));
vi.mock('./hero-carousel-card', () => ({ HeroCarouselCard: () => null }));
vi.mock('./social-media-card', () => ({ SocialMediaCard: () => null }));
vi.mock('./store-features-card', () => ({ StoreFeaturesCard: () => null }));
vi.mock('./update-storefront-profile', () => ({
  updateStorefrontProfile: mocks.updateStorefrontProfile,
}));
vi.mock('./get-merchant-settings-snapshot', () => ({
  getMerchantSettingsSnapshot: mocks.getMerchantSettingsSnapshot,
}));

import { SettingsFormContents } from './settings-form-contents';

const BUSINESS_PHONE = 'Business phone (used for courier pickups)';
const SUPPORT_PHONE = 'Public support phone';
const STORE_DESCRIPTION = 'Store description';
/** A legacy value saved before complete numbers were required. */
const TRUNCATED_PHONE = '+23415781';

function merchantWithPhone(
  phone: string,
  overrides: Partial<CachedMerchant> = {}
): CachedMerchant {
  return {
    id: 'merchant-a',
    business_name: 'Merchant A',
    site_title: '',
    site_tagline: '',
    site_description: '',
    business_type: 'FASHION',
    logo_url: '',
    phone,
    email: '',
    slug: 'merchant-a',
    business_address: '',
    country: 'NG',
    payout_currency: 'NGN',
    is_published: true,
    template_id: 'default',
    plan_tier: 'free',
    premium_features: null,
    updated_at: '2026-10-31T09:00:00.000Z',
    ...overrides,
  };
}

function renderSettings(phone: string, overrides?: Partial<CachedMerchant>) {
  render(
    <SettingsFormContents
      initialMerchant={merchantWithPhone(phone, overrides)}
      initialBlogEnabled={false}
    />
  );
  return screen.getByRole('textbox', { name: BUSINESS_PHONE });
}

function saveChanges() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
}

async function expectSavedSettings(settings: Record<string, string>) {
  await waitFor(() => {
    expect(mocks.updateStorefrontProfile).toHaveBeenCalledWith({
      merchantId: 'merchant-a',
      expectedUpdatedAt: '2026-10-31T09:00:00.000Z',
      settings,
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateStorefrontProfile.mockResolvedValue(undefined);
  mocks.getMerchantSettingsSnapshot.mockResolvedValue({
    business_name: 'Merchant A',
    country: 'NG',
    phone: '+234 803 123 4567',
    site_description: '',
    support_email: '',
    support_phone: '',
    updated_at: '2026-10-31T09:05:00.000Z',
  });
});

describe('bugfix: a stored truncated phone blocked unrelated settings saves', () => {
  it('saves a description change without re-checking or sending the untouched business phone', async () => {
    const businessPhone = renderSettings(TRUNCATED_PHONE);

    fireEvent.change(screen.getByRole('textbox', { name: STORE_DESCRIPTION }), {
      target: { value: 'Handmade leather goods.' },
    });
    saveChanges();

    await expectSavedSettings({ site_description: 'Handmade leather goods.' });
    expect(businessPhone).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still refuses a business phone edited to another truncated number', async () => {
    const businessPhone = renderSettings(TRUNCATED_PHONE);

    fireEvent.change(businessPhone, { target: { value: '+2341578' } });
    saveChanges();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the full business phone number with its country code, for example +234 801 234 5678.'
    );
    expect(businessPhone).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.updateStorefrontProfile).not.toHaveBeenCalled();
  });

  it('saves a description change without re-checking or sending an untouched legacy support phone', async () => {
    renderSettings('+2348031234567', { support_phone: '+23480312' });
    const supportPhone = screen.getByRole('textbox', { name: SUPPORT_PHONE });

    fireEvent.change(screen.getByRole('textbox', { name: STORE_DESCRIPTION }), {
      target: { value: 'Handmade leather goods.' },
    });
    saveChanges();

    await expectSavedSettings({ site_description: 'Handmade leather goods.' });
    expect(supportPhone).toHaveAttribute('aria-invalid', 'false');
  });

  it('still refuses a support phone edited to a truncated number', async () => {
    renderSettings('+2348031234567', { support_phone: '+23480312' });
    const supportPhone = screen.getByRole('textbox', { name: SUPPORT_PHONE });

    fireEvent.change(supportPhone, { target: { value: TRUNCATED_PHONE } });
    saveChanges();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a full support phone number, for example +234 801 234 5678.'
    );
    expect(supportPhone).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.updateStorefrontProfile).not.toHaveBeenCalled();
  });

  it('still lets a merchant clear the legacy business phone', async () => {
    const businessPhone = renderSettings(TRUNCATED_PHONE);

    fireEvent.change(businessPhone, { target: { value: '' } });
    saveChanges();

    await expectSavedSettings({ phone: '' });
  });
});

describe('bugfix: web merchants could not repair the courier pickup phone', () => {
  it('loads the current business phone into Store Settings', () => {
    expect(renderSettings('+2348031234567')).toHaveValue('+2348031234567');
  });

  it('refuses an implausible business phone before anything is saved', async () => {
    const businessPhone = renderSettings('+2348031234567');

    fireEvent.change(businessPhone, { target: { value: '+23415781' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the full business phone number with its country code, for example +234 801 234 5678.'
    );
    expect(businessPhone).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.updateStorefrontProfile).not.toHaveBeenCalled();
  });

  it('saves a corrected business phone through the guarded settings save', async () => {
    const businessPhone = renderSettings('+23415781');

    fireEvent.change(businessPhone, {
      target: { value: ' +234 803 123 4567 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mocks.updateStorefrontProfile).toHaveBeenCalledWith({
        merchantId: 'merchant-a',
        expectedUpdatedAt: '2026-10-31T09:00:00.000Z',
        settings: { phone: '+234 803 123 4567' },
      });
    });
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Settings Saved!' })
      );
    });
    expect(businessPhone).toHaveValue('+234 803 123 4567');
  });
});
