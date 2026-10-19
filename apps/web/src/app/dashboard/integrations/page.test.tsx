import { render, screen, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/merchant-server', () => ({
  getMerchantForUser: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

import { redirect } from 'next/navigation';
import { getMerchantForUser } from '@/lib/merchant-server';
import SocialPlatformsPage, { metadata } from './page';

describe('dashboard social platforms page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMerchantForUser).mockResolvedValue({
      merchant: { id: 'merchant-1' },
    } as never);
  });

  it('presents the integrations hub as Social Platforms', async () => {
    render(await SocialPlatformsPage());

    expect(metadata).toMatchObject({
      title: 'Social Platforms | Baci',
      description:
        'Reach more customers and track them efficiently across social platforms.',
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Social Platforms' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Reach more customers and track them efficiently across social platforms.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /configure/i }).length
    ).toBeGreaterThan(0);
  });

  it('shows configured states from merchant feature settings', async () => {
    vi.mocked(getMerchantForUser).mockResolvedValue({
      merchant: {
        id: 'merchant-1',
        feature_settings: {
          facebook_pixel_id: '1234567890',
          facebook_capi_token: 'fb-token',
          tiktok_pixel_id: 'CT123',
          tiktok_access_token: null,
          google_analytics_id: 'G-1234567890',
          ga4_api_secret: 'ga-secret',
          twitter_pixel_id: 'tw-pixel',
        },
      },
    } as never);

    render(await SocialPlatformsPage());

    const facebookCard = screen.getByLabelText(
      'Facebook & Instagram integration'
    );
    expect(within(facebookCard).getByText('Active')).toBeInTheDocument();
    expect(
      within(facebookCard).getByRole('link', { name: /manage/i })
    ).toHaveAttribute('href', '/dashboard/integrations/facebook');

    const tiktokCard = screen.getByLabelText('TikTok Shopping integration');
    expect(within(tiktokCard).getByText('Partial')).toBeInTheDocument();
    expect(
      within(tiktokCard).getByRole('link', { name: /finish setup/i })
    ).toHaveAttribute('href', '/dashboard/integrations/tiktok');

    const snapchatCard = screen.getByLabelText('Snapchat integration');
    expect(
      within(snapchatCard).getByText('Not configured')
    ).toBeInTheDocument();
    expect(
      within(snapchatCard).getByRole('link', { name: /configure/i })
    ).toHaveAttribute('href', '/dashboard/integrations/snapchat');

    const analyticsCard = screen.getByLabelText(
      'Google Analytics 4 integration'
    );
    expect(within(analyticsCard).getByText('Active')).toBeInTheDocument();

    const twitterCard = screen.getByLabelText('Twitter (X) integration');
    expect(within(twitterCard).getByText('Active')).toBeInTheDocument();
  });

  it('labels Google Merchant Center as feed ready instead of connected', async () => {
    render(await SocialPlatformsPage());

    const merchantCenterCard = screen.getByLabelText(
      'Google Merchant Center integration'
    );
    expect(
      within(merchantCenterCard).getByText('Feed ready')
    ).toBeInTheDocument();
    expect(
      within(merchantCenterCard).getByRole('link', { name: /setup guide/i })
    ).toHaveAttribute('href', '/dashboard/integrations/google-merchant');
    expect(within(merchantCenterCard).queryByText('Connected')).toBeNull();
  });

  it('links the owners-only Muse connector without claiming a state', async () => {
    render(await SocialPlatformsPage());

    const museCard = screen.getByLabelText('Muse integration');
    expect(within(museCard).getByText('Owners only')).toBeInTheDocument();
    expect(
      within(museCard).getByRole('link', { name: /open/i })
    ).toHaveAttribute('href', '/dashboard/integrations/muse');
  });

  it('redirects to login when no merchant is available', async () => {
    vi.mocked(getMerchantForUser).mockResolvedValue({
      merchant: null,
    } as never);

    await SocialPlatformsPage();

    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
