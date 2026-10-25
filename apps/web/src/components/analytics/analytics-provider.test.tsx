import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantWithAnalytics } from './analytics-pixel-provider';

const mockUseMerchantSafe = vi.hoisted(() => vi.fn());
const mockAnalyticsPixelProvider = vi.hoisted(() => vi.fn(() => null));

vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: mockUseMerchantSafe,
}));

vi.mock('./analytics-pixel-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./analytics-pixel-provider')>();

  return {
    ...actual,
    AnalyticsPixelProvider: mockAnalyticsPixelProvider,
  };
});

import { AnalyticsProvider } from './analytics-provider';

describe('AnalyticsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes analytics IDs before passing context merchant data to pixels', () => {
    mockUseMerchantSafe.mockReturnValue({
      merchant: {
        feature_settings: {
          chatgpt_pixel_id: ' chatgpt-context ',
          google_analytics_id: '   ',
          facebook_pixel_id: 12345,
        },
        google_analytics_id: ' G-CONTEXT ',
        plan_expires_at: null,
        plan_tier: 'pro',
        tiktok_pixel_id: false,
        snapchat_pixel_id: ' snap-1 ',
        twitter_pixel_id: {},
      },
    });

    render(<AnalyticsProvider />);

    expect(mockAnalyticsPixelProvider).toHaveBeenCalledWith(
      {
        merchant: {
          chatgpt_pixel_id: 'chatgpt-context',
          google_analytics_id: 'G-CONTEXT',
          facebook_pixel_id: '12345',
          tiktok_pixel_id: null,
          snapchat_pixel_id: 'snap-1',
          twitter_pixel_id: null,
        },
      },
      undefined
    );
  });

  it('normalizes explicit merchant analytics IDs before falling back to context', () => {
    mockUseMerchantSafe.mockReturnValue({
      merchant: {
        google_analytics_id: 'G-CONTEXT',
      },
    });

    const merchant = {
      feature_settings: {
        google_analytics_id: ' G-FEATURE ',
      },
      google_analytics_id: 'G-LEGACY',
      plan_expires_at: null,
      plan_tier: 'pro',
    } as unknown as MerchantWithAnalytics;

    render(<AnalyticsProvider merchant={merchant} />);

    expect(mockAnalyticsPixelProvider).toHaveBeenCalledWith(
      {
        merchant: {
          chatgpt_pixel_id: null,
          google_analytics_id: 'G-FEATURE',
          facebook_pixel_id: null,
          tiktok_pixel_id: null,
          snapchat_pixel_id: null,
          twitter_pixel_id: null,
        },
      },
      undefined
    );
  });

  it('does not pass stale storefront pixel IDs for locked merchants', () => {
    mockUseMerchantSafe.mockReturnValue({
      merchant: {
        feature_settings: {
          chatgpt_pixel_id: 'chatgpt-locked',
          google_analytics_id: 'G-FREE',
        },
        facebook_pixel_id: '12345',
        plan_tier: 'free',
        premium_features: [],
      },
    });

    render(<AnalyticsProvider />);

    expect(mockAnalyticsPixelProvider).toHaveBeenCalledWith(
      {
        merchant: {
          chatgpt_pixel_id: null,
          google_analytics_id: null,
          facebook_pixel_id: null,
          tiktok_pixel_id: null,
          snapchat_pixel_id: null,
          twitter_pixel_id: null,
        },
      },
      undefined
    );
  });
});
