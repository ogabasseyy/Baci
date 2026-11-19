import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import { SettingsForm } from './settings-form';

vi.mock('./branding-card', () => ({
  BrandingCard: () => <div data-testid="branding-card" />,
}));

vi.mock('./hero-carousel-card', () => ({
  HeroCarouselCard: () => <div data-testid="hero-carousel-card" />,
}));

vi.mock('./social-media-card', () => ({
  SocialMediaCard: ({
    onSocialMediaChange,
  }: {
    onSocialMediaChange: (socialMedia: Record<string, string>) => void;
  }) => (
    <button
      type="button"
      onClick={() => onSocialMediaChange({ twitter: '@test' })}
    >
      Social media
    </button>
  ),
}));

vi.mock('./store-features-card', () => ({
  StoreFeaturesCard: () => <div data-testid="store-features-card" />,
}));

vi.mock('@/app/dashboard/settings/favicon-upload', () => ({
  FaviconUpload: () => <div data-testid="favicon-upload" />,
}));

vi.mock('@/components/dashboard/dashboard-ad-unit', () => ({
  DashboardAdUnit: () => <div data-testid="ad-unit" />,
}));

vi.mock('colord/plugins/a11y', () => ({ default: () => undefined }));
vi.mock('colord', () => ({ extend: vi.fn() }));

vi.mock('./settings-utils', () => {
  const z = require('zod');
  const settingsSchema = z.object({
    business_name: z.string().min(2),
    country: z.string().min(2),
    site_description: z.string().default(''),
    support_email: z.string().default(''),
    support_phone: z.string().default(''),
  });
  return {
    createSettingsSchema: () => settingsSchema,
    settingsSchema,
    extractColorsFromImage: vi.fn(),
    sanitizeSocialMedia: (socialMedia: Record<string, string>) => socialMedia,
  };
});

const mockUpdateMerchant = vi.fn();
const mockReloadMerchant = vi.fn();
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    reloadMerchant: mockReloadMerchant,
    updateMerchant: mockUpdateMerchant,
  }),
}));

const mockUpdateSocial = vi.fn();
vi.mock('@/hooks/merchant/update-social', () => ({
  updateSocial: (...args: unknown[]) => mockUpdateSocial(...args),
}));

vi.mock('./update-storefront-profile', () => ({
  updateStorefrontProfile: vi.fn(),
}));
const mockGetMerchantSettingsSnapshot = vi.fn();
vi.mock('./get-merchant-settings-snapshot', () => ({
  getMerchantSettingsSnapshot: (...args: unknown[]) =>
    mockGetMerchantSettingsSnapshot(...args),
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockMerchant: CachedMerchant = {
  id: 'merchant-1',
  business_name: 'Test Store',
  site_title: 'Test',
  site_tagline: '',
  site_description: '',
  business_type: 'FASHION',
  logo_url: '',
  phone: '',
  email: '',
  slug: 'test-store',
  business_address: '',
  payout_currency: 'NGN',
  is_published: true,
  template_id: 'ogabassey',
  plan_tier: 'free',
  premium_features: null,
  brand_colors: { primary: '#000', background: '#FFF', accent: '#F00' },
  country: 'NG',
  hero_slides: [],
  mobile_hero_slides: [],
  social_media: {
    twitter: '',
    facebook: '',
    instagram: '',
    tiktok: '',
    youtube: '',
    pinterest: '',
    linkedin: '',
    snapchat: '',
  },
};

function submitSettingsForm() {
  const form = screen
    .getByRole('button', { name: /save changes/i })
    .closest('form');

  if (!form) throw new Error('Form not found');
  fireEvent.submit(form);
}

describe('SettingsForm social save orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantSettingsSnapshot.mockResolvedValue({
      business_name: 'Test Store',
      country: 'NG',
      site_description: '',
      support_email: '',
      support_phone: '',
      updated_at: '2026-08-04T06:00:00.000Z',
    });
  });

  it('saves edited social media before generic fields without an implicit context reload', async () => {
    mockUpdateMerchant.mockResolvedValueOnce(undefined);
    mockUpdateSocial.mockResolvedValueOnce({
      merchant: { id: 'merchant-1', social_media: { twitter: '@test' } },
    });
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Social media' }));

    submitSettingsForm();

    await waitFor(() => {
      expect(mockUpdateMerchant).not.toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockUpdateSocial).toHaveBeenCalledWith(
        'merchant-1',
        expect.objectContaining({ twitter: '@test' })
      );
    });
    expect(mockReloadMerchant).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Settings Saved!',
        description: 'Your store settings have been updated.',
      });
    });
  });

  it('does not send an unchanged social draft during a generic settings save', async () => {
    mockUpdateMerchant.mockResolvedValueOnce(undefined);
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );

    submitSettingsForm();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockUpdateMerchant).not.toHaveBeenCalled();
    expect(mockUpdateSocial).not.toHaveBeenCalled();
    expect(mockReloadMerchant).not.toHaveBeenCalled();
  });

  it('drops an unsaved social draft before submitting after the merchant changes', async () => {
    const merchantB = {
      ...mockMerchant,
      id: 'merchant-2',
      business_name: 'Second Store',
      slug: 'second-store',
    };
    mockUpdateMerchant.mockResolvedValueOnce(undefined);
    const rendered = render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Social media' }));
    rendered.rerender(
      <SettingsForm initialMerchant={merchantB} initialBlogEnabled={false} />
    );
    submitSettingsForm();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockUpdateMerchant).not.toHaveBeenCalled();
    expect(mockUpdateSocial).not.toHaveBeenCalled();
  });

  it('finishes a first merchant write without updating the switched store UI', async () => {
    let resolveSocial: (() => void) | undefined;
    mockUpdateSocial.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSocial = resolve;
      })
    );
    const merchantB = {
      ...mockMerchant,
      id: 'merchant-2',
      business_name: 'Second Store',
      slug: 'second-store',
    };
    const rendered = render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Social media' }));
    submitSettingsForm();
    await waitFor(() => expect(mockUpdateSocial).toHaveBeenCalledTimes(1));

    rendered.rerender(
      <SettingsForm initialMerchant={merchantB} initialBlogEnabled={false} />
    );
    resolveSocial?.();

    await waitFor(() => expect(mockUpdateSocial).toHaveBeenCalledTimes(1));
    expect(mockUpdateMerchant).not.toHaveBeenCalled();
    expect(mockReloadMerchant).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('does not surface a first merchant save failure after switching stores', async () => {
    let rejectSocial: ((error: Error) => void) | undefined;
    mockUpdateSocial.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectSocial = reject;
      })
    );
    const merchantB = {
      ...mockMerchant,
      id: 'merchant-2',
      business_name: 'Second Store',
      slug: 'second-store',
    };
    const rendered = render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Social media' }));
    submitSettingsForm();
    await waitFor(() => expect(mockUpdateSocial).toHaveBeenCalledTimes(1));

    rendered.rerender(
      <SettingsForm initialMerchant={merchantB} initialBlogEnabled={false} />
    );
    rejectSocial?.(new Error('first-store failure'));

    await waitFor(() => expect(mockUpdateMerchant).not.toHaveBeenCalled());
    expect(mockReloadMerchant).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('does not partially commit generic settings when the social update fails', async () => {
    mockUpdateSocial.mockRejectedValueOnce(new Error('Sign in again'));
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Social media' }));

    submitSettingsForm();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error Saving Settings',
        description: 'Sign in again',
        variant: 'destructive',
      });
    });
    expect(mockUpdateMerchant).not.toHaveBeenCalled();
    expect(mockReloadMerchant).not.toHaveBeenCalled();
  });
});
