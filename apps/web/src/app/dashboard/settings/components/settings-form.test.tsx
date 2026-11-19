import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import { SettingsForm } from './settings-form';

vi.mock('./branding-card', () => ({
  BrandingCard: ({
    onColorChange,
    onShuffleColors,
  }: {
    onColorChange: (role: 'primary', color: string) => void;
    onShuffleColors: () => void;
  }) => (
    <div data-testid="branding-card">
      <button type="button" onClick={() => onColorChange('primary', '#123456')}>
        Change primary color
      </button>
      <button type="button" onClick={onShuffleColors}>
        Shuffle colors
      </button>
    </div>
  ),
}));

vi.mock('./hero-carousel-card', () => ({
  HeroCarouselCard: ({
    onSlidesChange,
  }: {
    onSlidesChange: (slides: Array<{ id: string }>) => void;
  }) => (
    <button
      data-testid="hero-carousel-card"
      type="button"
      onClick={() => onSlidesChange([{ id: 'hero-1' }])}
    >
      Edit hero carousel
    </button>
  ),
}));

vi.mock('./social-media-card', () => ({
  SocialMediaCard: ({
    onSocialMediaChange,
  }: {
    onSocialMediaChange: (sm: Record<string, string>) => void;
  }) => (
    <button
      data-testid="social-media-card"
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

vi.mock('colord/plugins/a11y', () => ({
  default: () => {},
}));
vi.mock('colord', () => ({ extend: vi.fn() }));

vi.mock('./settings-utils', () => {
  const z = require('zod');
  const settingsSchema = z.object({
    business_name: z.string().min(2),
    country: z.string().min(2),
    site_description: z.string(),
    support_email: z.string(),
    support_phone: z.string(),
  });
  return {
    createSettingsSchema: () => settingsSchema,
    settingsSchema,
    extractColorsFromImage: vi.fn(),
    sanitizeSocialMedia: (sm: Record<string, string>) => sm,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./get-merchant-settings-snapshot', () => ({
  getMerchantSettingsSnapshot: vi.fn().mockResolvedValue({
    business_name: 'Test Store',
    country: 'NG',
    site_description: '',
    support_email: '',
    support_phone: '',
    updated_at: '2026-08-04T10:01:00.000Z',
  }),
}));

const mockUpdateMerchant = vi.fn();
const mockReloadMerchant = vi.fn();
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    reloadMerchant: mockReloadMerchant,
    updateMerchant: mockUpdateMerchant,
  }),
}));

// social_media is an identity field — it persists via the dedicated PATCH route
// (updateSocial), not the generic updateMerchant hook.
const mockUpdateSocial = vi.fn();
vi.mock('@/hooks/merchant/update-social', () => ({
  updateSocial: (data: Record<string, string>) => mockUpdateSocial(data),
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
  support_email: '',
  support_phone: '',
  updated_at: '2026-08-04T10:00:00.000Z',
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

describe('SettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form with all child components', () => {
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );

    expect(screen.getByTestId('branding-card')).toBeInTheDocument();
    expect(screen.getByTestId('store-features-card')).toBeInTheDocument();
    expect(screen.getByTestId('favicon-upload')).toBeInTheDocument();
    expect(screen.getByTestId('ad-unit')).toBeInTheDocument();
    expect(screen.getByTestId('hero-carousel-card')).toBeInTheDocument();
    expect(screen.getByTestId('social-media-card')).toBeInTheDocument();
  });

  it('renders Save Changes button', () => {
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );

    expect(
      screen.getByRole('button', { name: /save changes/i })
    ).toBeInTheDocument();
  });

  it('shows error toast when updateMerchant rejects', async () => {
    const error = new Error('Update failed');
    mockUpdateMerchant.mockRejectedValueOnce(error);
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit hero carousel' }));
    const form = screen
      .getByRole('button', { name: /save changes/i })
      .closest('form');

    if (!form) throw new Error('Form not found');

    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error Saving Settings',
        description: 'Update failed',
        variant: 'destructive',
      });
    });
  });

  it('save button shows loading state during submission', async () => {
    let resolveUpdate: (() => void) | undefined;
    mockUpdateMerchant.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        })
    );
    render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit hero carousel' }));
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    const form = saveButton.closest('form');

    if (!form) throw new Error('Form not found');

    fireEvent.submit(form);

    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });

    await act(async () => {
      resolveUpdate?.();
    });

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it('writes branding changes to the selected merchant after switching stores', async () => {
    const merchantB = {
      ...mockMerchant,
      id: 'merchant-2',
      business_name: 'Second Store',
      brand_colors: { primary: '#111', background: '#222', accent: '#333' },
    };
    mockUpdateMerchant.mockResolvedValue(undefined);
    const rendered = render(
      <SettingsForm initialMerchant={mockMerchant} initialBlogEnabled={false} />
    );

    rendered.rerender(
      <SettingsForm initialMerchant={merchantB} initialBlogEnabled={false} />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Change primary color' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle colors' }));

    await waitFor(() => {
      expect(mockUpdateMerchant).toHaveBeenCalledWith(
        expect.objectContaining({
          brand_colors: expect.objectContaining({ primary: '#123456' }),
        }),
        { merchantId: 'merchant-2', skipReload: true }
      );
      expect(mockUpdateMerchant).toHaveBeenCalledWith(
        expect.objectContaining({
          brand_colors: {
            primary: '#333',
            background: '#123456',
            accent: '#222',
          },
        }),
        { merchantId: 'merchant-2', skipReload: true }
      );
    });
  });
});
